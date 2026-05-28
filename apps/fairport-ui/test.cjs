const DB_FILE = 'db.yaml';
const fs = require('fs');
const yaml = require('js-yaml');
const data = yaml.load(fs.readFileSync(DB_FILE, 'utf8'));
console.log("Users:", data.users.length);
console.log("API Keys:", data.api_keys.length);
if (data.users.length > 0) {
  const lastUser = data.users[data.users.length-1];
  console.log("Last user:", lastUser);
  const lastUserKeys = data.api_keys.filter(k => k.owner_id === lastUser.id);
  console.log("Keys for last user:", lastUserKeys);
}
