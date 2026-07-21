const db = require('./config/db');

async function main() {
  try {
    await db.initializeDatabase();
    
    console.log("--- Contests Table count ---");
    const count = await db.query("SELECT COUNT(*) as cnt FROM Contests");
    console.log(count);

    console.log("--- Fake Contests count ---");
    const fakeCount = await db.query("SELECT COUNT(*) as cnt FROM Contests WHERE slug = 'weekly-contest-999' OR title LIKE '%999%' OR contest_number = 999");
    console.log(fakeCount);

    console.log("--- Sample Contests ---");
    const sample = await db.query("SELECT contest_id, title, slug, contest_number, start_time FROM Contests ORDER BY contest_number DESC LIMIT 10");
    console.log(sample);

    console.log("--- LiveContests Table count ---");
    const liveCount = await db.query("SELECT COUNT(*) as cnt FROM LiveContests");
    console.log(liveCount);

    console.log("--- LiveContests Sample ---");
    const liveSample = await db.query("SELECT id, contestSlug, contestName, startTime FROM LiveContests ORDER BY startTime DESC LIMIT 10");
    console.log(liveSample);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
