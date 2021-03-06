/*
 * Monkey-patch https.request to proxy request to the broker server
 * according the the env variables `https_proxy` and `no_proxy`:
 * get the https proxy from the env. proxy requests unless the
 * broker server is in the no_proxy list.
 * Start from the "Entry point" below.
 */
const url = require('url');
const tunnel = require('tunnel');
const {brokerServerUrl, httpsProxy, noProxy} = require('./config');
const brokerServer = url.parse(brokerServerUrl || '');
brokerServer.port = brokerServer.port ||
  brokerServer.protocol === 'https:' ? '443' : '80';

// adapted from https://github.com/request/request/master/lib/getProxyFromURI.js

function formatHostname(hostname) {
  // canonicalize the hostname, so that 'oogle.com' won't match 'google.com'
  return hostname.replace(/^\.*/, '.').toLowerCase();
}

function parseNoProxyZone(zone) {
  zone = zone.trim().toLowerCase();

  const zoneParts = zone.split(':', 2);
  const zoneHost = formatHostname(zoneParts[0]);
  const zonePort = zoneParts[1];
  const hasPort = zone.indexOf(':') > -1;

  return {hostname: zoneHost, port: zonePort, hasPort: hasPort};
}

function uriInNoProxy(uri) {
  const port = uri.port || (uri.protocol === 'https:' ? '443' : '80');
  const hostname = formatHostname(uri.hostname);
  const noProxyList = noProxy.split(',');

  // iterate through the noProxyList until it finds a match.
  return noProxyList.map(parseNoProxyZone).some(function (noProxyZone) {
    const isMatchedAt = hostname.indexOf(noProxyZone.hostname);
    const hostnameMatched = (
      isMatchedAt > -1 &&
        (isMatchedAt === hostname.length - noProxyZone.hostname.length));

    if (noProxyZone.hasPort) {
      return (port === noProxyZone.port) && hostnameMatched;
    }

    return hostnameMatched;
  });
}

function shouldProxy(uri) {
  // Decide the proper request proxy to use based on the request URI object and the
  // environmental variables (NO_PROXY, HTTP_PROXY, etc.)
  // respect NO_PROXY environment variables (see: http://lynx.isc.org/current/breakout/lynx_help/keystrokes/environments.html)

  // if no https proxy is defined - don't proxy

  if (!httpsProxy) {
    return false;
  }

  // if the noProxy is a wildcard then return null

  if (noProxy === '*') {
    return false;
  }

  // if the noProxy is not empty and the uri is found return null

  if (noProxy && noProxy !== '' && uriInNoProxy(uri)) {
    return false;
  }

  // we should proxy
  return true;
}

// Entry point: To patch or not to patch?
if (brokerServer.host && httpsProxy && shouldProxy(brokerServer)) {
  const proxy = url.parse(httpsProxy);
  const tunnelingAgent = tunnel.httpsOverHttp({
    proxy: {
      host: proxy.hostname,
      port: proxy.port
    }
  });

  // actual monkey patching: BEWARE!
  // we're only patching HTTPS requests to the broker server
  const https = require('https');
  const oldhttpsreq = https.request;
  https.request = function (options, callback) {
    if (options.host === brokerServer.host) {
      options.agent = tunnelingAgent;
    }
    return oldhttpsreq.call(null, options, callback);
  };
}

module.exports = {shouldProxy};   // for testing
