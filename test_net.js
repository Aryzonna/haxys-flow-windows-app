const { app, net } = require('electron');

app.whenReady().then(() => {
  const request = net.request({
    url: 'https://core.haxys.com.br/version.json?_=' + Date.now(),
    partition: 'persist:haxyscore'
  });

  request.on('response', (response) => {
    console.log('Status:', response.statusCode);
    let data = '';
    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => {
      console.log('Body:', data);
      app.quit();
    });
  });

  request.end();
});
