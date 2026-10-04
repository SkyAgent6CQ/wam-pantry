// Relax Jenkins' Content-Security-Policy just enough for the published HTML
// reports (coverage, security summary) to render their own CSS. Local lab only.
System.setProperty('hudson.model.DirectoryBrowserSupport.CSP',
  "sandbox allow-scripts; default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline';")
