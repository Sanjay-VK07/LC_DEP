const fs = require('fs');

function parseCodeChefHtml(html) {
  const result = {
    rating: null,
    highestRating: null,
    globalRank: null,
    stars: null,
    problemsSolved: 0
  };

  // Improved Rating Regex
  const ratingMatch = html.match(/class="rating-number"[^>]*>\s*(\d+)\??/i) ||
                      html.match(/rating-number[^>]*>\s*(\d+)\??/i) ||
                      html.match(/"currentRating"\s*:\s*(\d+)/i);
  if (ratingMatch) result.rating = parseInt(ratingMatch[1], 10);

  // Highest Rating
  const highestMatch = html.match(/Highest Rating\D+(\d+)/i) ||
                       html.match(/\(Highest Rating\s+(\d+)\)/i) ||
                       html.match(/"highestRating"\s*:\s*(\d+)/i);
  if (highestMatch) result.highestRating = parseInt(highestMatch[1], 10);

  return result;
}

const html = fs.readFileSync('scratch/codechef_divyaroopag.html', 'utf8');
const result = parseCodeChefHtml(html);
console.log('Result:', result);
process.exit(0);
