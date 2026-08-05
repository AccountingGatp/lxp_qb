const { app } = require('./app');
const { config } = require('./config');

app.listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
  console.log(`OAuth connect URL: http://localhost:${config.port}/auth/connect`);
});
