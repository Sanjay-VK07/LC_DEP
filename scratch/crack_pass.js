const bcrypt = require('../backend/node_modules/bcryptjs');

const hash = '$2a$10$uB/V.y8D98zzjOTOWUFvjeYqXZf9/JTHES6uGrjv11KOqBriUOFue';

const words = [
  'admin', 'admin123', 'admin@123', 'cse', 'cse123', 'cse1234', 'cseadmin', 'cseadmin123',
  'password', 'password123', '123456', '12345678', 'enthra', 'enthrahub', 'enthra123',
  'college', 'college123', 'DEC', 'DEC123', 'dec123', 'SuperAdmin', 'SuperAdmin123',
  'Pass@123', 'Admin@123', 'Cse@123', 'cse@123', 'root', 'root123', 'secret'
];

async function run() {
  for (const w of words) {
    if (await bcrypt.compare(w, hash)) {
      console.log('SUCCESS! PASSWORD IS:', w);
      process.exit(0);
    }
  }
  console.log('No match found in quick list.');
}

run();
