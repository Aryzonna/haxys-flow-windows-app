const https = require('https');
https.get('https://core.haxys.com.br/version.json?_=' + Date.now(), (res) => {
  console.log('Status Code:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Body:', data);
  });
});
