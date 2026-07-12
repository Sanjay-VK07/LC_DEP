const http = require('http');

http.get('http://localhost:5000/api/contestmaster/leetcode', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log("Success:", parsed.success);
      console.log("Metrics:", parsed.metrics);
      console.log("Number of contests:", parsed.contests?.length);
      console.log("Sample Contests (first 2):", parsed.contests?.slice(0, 2));
      console.log("Sample monthly trend data:", parsed.monthlyTrendData);
      console.log("Sample semester analytics:", parsed.semesterAnalyticsData);
      console.log("Sample batch comparison data:", parsed.batchComparisonData);
      console.log("Sample student summaries:", parsed.studentSummaries?.slice(0, 2));
      console.log("Sample platform ranking:", parsed.platformRanking);
    } catch (e) {
      console.log("Response was not JSON:", data);
    }
  });
}).on('error', (err) => {
  console.error("HTTP Request Error:", err.message);
});
