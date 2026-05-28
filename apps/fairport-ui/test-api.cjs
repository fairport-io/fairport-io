const axios = require('axios');
const http = require('http');

async function run() {
  const agent = new http.Agent({ keepAlive: true });
  const client = axios.create({ baseURL: 'http://localhost:3000', httpAgent: agent });
  
  let cookie = '';
  // Signup
  const username = `test-${Date.now()}@test.com`;
  const res = await client.post('/api/auth/signup', { username, password: 'password123' });
  console.log("Signup:", res.data);
  cookie = res.headers['set-cookie'][0];
  console.log("Cookie:", cookie);
  
  // Get Keys
  const keysRes = await client.get('/api/keys', { headers: { Cookie: cookie } });
  console.log("Keys:", keysRes.data);
}
run();
