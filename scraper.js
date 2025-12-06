const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

const TARGET_URL = 'https://www.seek.com.au/medical-jobs?sortmode=ListedDate&postedDate=28';
const TARGET_MONTH = 'November'; // For filtering later

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildHtmlTable(jobs) {
    const rows = jobs.map(job => `
            <tr>
                <td>${escapeHtml(job.title)}</td>
                <td>${escapeHtml(job.company)}</td>
                <td>${escapeHtml(job.location)}</td>
                <td>${escapeHtml(job.posted_text || '')}</td>
                <td>${escapeHtml(job.actual_date || '')}</td>
                <td><a href="${escapeHtml(job.link)}" target="_blank" rel="noopener noreferrer">View</a></td>
            </tr>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jobs Report</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f6f8fb; color: #1a1f36; margin: 24px; }
        h1 { margin-bottom: 12px; }
        .summary { margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
        th, td { padding: 12px 10px; border-bottom: 1px solid #e4e7eb; text-align: left; }
        th { background: #23395d; color: #fff; }
        tr:nth-child(every) { background: #f9fbff; }
        tr:hover { background: #eef3fb; }
        a { color: #1b73e8; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .empty { padding: 20px; text-align: center; color: #6c7480; }
    </style>
</head>
<body>
    <h1>Seek Jobs Report</h1>
    <div class="summary">Total jobs: ${jobs.length}</div>
    ${jobs.length === 0 ? '<div class="empty">No jobs found.</div>' : `
    <table>
        <thead>
            <tr>
                <th>Title</th>
                <th>Company</th>
                <th>Location</th>
                <th>Posted Text</th>
                <th>Actual Date</th>
                <th>Link</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>`}
</body>
</html>`;
}

function formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function matchesTitleKeywords(title) {
    const keywords = [
        'General Practitioner',
        'Dentist',
        'Podiatrist',
        'Psychologist',
        'Physiotherapist',
        'Speech Pathologist',
        'Occupational Therapist'
    ];
    const lowerTitle = title.toLowerCase();
    return keywords.some(keyword => lowerTitle.includes(keyword.toLowerCase()));
}

function getActualDate(postDateText) {
    const today = new Date();
    let cleanedText = postDateText;
    
    // Step 1: Clean the input string by capturing the first valid date unit and throwing the rest away.
    // This handles duplicates like '7h ago7h ago' and includes absolute dates like '28 Nov'
    const cleanMatch = postDateText.match(/(\d+\s*(h|d|w|m)\s*ago|\d+\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i);
    if (cleanMatch) {
        cleanedText = cleanMatch[0].trim();
    } else if (postDateText.toLowerCase().includes('just now')) {
        // Handle "Just now" which is today
        return today; 
    } else {
        return null; // Can't parse anything
    }

    // 2. Relative Dates (h/d/w/m ago)
    const relativeMatch = cleanedText.match(/(\d+)\s*(h|d|w|m)\s*ago/i);
    if (relativeMatch) {
        const value = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2].charAt(0).toLowerCase();
        const postedDate = new Date(today);
        
        if (unit === 'd') {
            postedDate.setDate(today.getDate() - value);
        } else if (unit === 'h') {
            postedDate.setHours(today.getHours() - value);
        } else if (unit === 'w') { 
            postedDate.setDate(today.getDate() - (value * 7));
        }
        return postedDate;
    }
    
    // 3. Absolute Dates (e.g., '28 Nov')
    const absoluteMatch = cleanedText.match(/(\d+)\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if (absoluteMatch) {
        const day = parseInt(absoluteMatch[1]);
        const monthAbbr = absoluteMatch[2];
        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].findIndex(m => m.toLowerCase() === monthAbbr.toLowerCase());
        
        if (monthIndex > -1) {
            // Setting the year correctly is critical for absolute dates
            const postedDate = new Date(today.getFullYear(), monthIndex, day);
            return postedDate;
        }
    }
    
    return null; // Fallback
}

async function scrapeSeek() {
    const browser = await puppeteer.launch({ 
        headless: true,
        // Add arguments to reduce detection markers
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-infobars',
            '--window-size=1920,1080'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    const allJobs = [];

    // ... (target variables)
    const TARGET_MONTH_INDEX = 11; // November (0-indexed)
    const TARGET_YEAR = new Date().getFullYear(); // 2025

    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage && currentPage <= 5) { // Limiting to 5 pages for example
        const url = `${TARGET_URL}&page=${currentPage}`;
        console.log(`Navigating to page ${currentPage}: ${url}`);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        await new Promise(r => setTimeout(r, 5000));
        // Wait for the job listings to be visible on the page
        await page.waitForSelector('[data-automation="jobTitle"]', { timeout: 15000 });

        // Get the HTML content after the page is fully rendered
        const html = await page.content();
        const $ = cheerio.load(html);

        // Select all job listing cards
        const jobCards = $('[data-testid="job-card"]');

        jobCards.each((index, element) => {
            try {
                const titleAnchor = $(element).find('[data-automation="jobTitle"]');
                const title = titleAnchor.text().trim();
                const linkPath = titleAnchor.attr('href');
                const link = 'https://www.seek.com.au' + linkPath;
                const company = $(element).find('[data-automation="jobCompany"]').text().trim();
                const location = $(element).find('[data-automation="jobCardLocation"]').text().trim();
                // const postDateText = $(element).find('[data-automation="job-listing-date"]').text().trim();
                const postDateText = $(element).find('[data-automation="jobListingDate"]').text().trim();
                

                // --- Crucial Filtering Step ---
                // The date posted on Seek often looks like "1d ago" or "30/Oct/2025"
                // You need to develop a logic to parse this `postDateText` and check if it falls in November.
                // For "1d ago" and similar relative times, you must check if that relative date falls in November.
 
                const actualPostedDate = getActualDate(postDateText);
                // For demonstration, we'll only look for a simplified "November" check in the text.
                
                if (actualPostedDate) {
                    const postedMonth = actualPostedDate.getMonth(); // 0 = Jan, 10 = Nov, 11 = Dec
                    const postedYear = actualPostedDate.getFullYear();
    
                    // Check if the month is November (10) AND the year is the target year (e.g., 2025)
                    // NOTE: You must set the correct TARGET_YEAR based on when you run the script.
                    const TARGET_MONTH_INDEX = 11; // November
                    const TARGET_YEAR = new Date().getFullYear(); // Assuming you want Nov of the current year

                    if (postedMonth === TARGET_MONTH_INDEX && postedYear === TARGET_YEAR) {
                        // Filter by job title keywords
                        if (matchesTitleKeywords(title)) {
                            allJobs.push({
                                title,
                                company,
                                location,
                                posted_text: postDateText,
                                actual_date: actualPostedDate.toDateString(), // Store the real date
                                link
                            });
                        }
                    }
                }

                // let parsedDate = 'NULL';
                // let postedMonth = 'N/A';
                // let postedYear = 'N/A';
                // let isTargetMonth = false;

                // if (actualPostedDate) {
                //     parsedDate = actualPostedDate.toDateString();
                //     postedMonth = actualPostedDate.getMonth();
                //     postedYear = actualPostedDate.getFullYear();
                //     if (postedMonth === TARGET_MONTH_INDEX && postedYear === TARGET_YEAR) {
                //         isTargetMonth = true;
                //     }
                // }



                //                 allJobs.push({
                //     title,
                //     company,
                //     location,
                //     raw_date_text: postDateText, 
                //     parsed_date: parsedDate,
                //     parsed_month: postedMonth,
                //     parsed_year: postedYear,
                //     is_nov_match: isTargetMonth,
                //     link
                // });
            } catch (error) {
                console.error('Error processing job card:', error);
            }
        });

        // Determine if there is a next page
        const nextLink = $('a[aria-label="Next"], a[title="Next"]');
        const hasNextPage = nextLink.length > 0 && nextLink.attr('href').includes('page=');
        // hasNextPage = nextButton.length > 0 && !nextButton.prop('disabled');
        currentPage++;
    }

    await browser.close();
    
    console.log(`\n✅ Scraping complete. Found ${allJobs.length} jobs in November (or with 'Nov' in post date).`);
    // console.log(allJobs);

    // Output a readable table to the console and write an HTML report to disk
    // console.table(allJobs);
    const reportHtml = buildHtmlTable(allJobs);
    const outputPath = `${process.cwd()}/jobs-report.html`;
    fs.writeFileSync(outputPath, reportHtml, 'utf8');
    console.log(`HTML report saved to ${outputPath}`);
}

(async () => {
    const startTime = Date.now();
    console.log('🔄 Starting scrape...');
    
    await scrapeSeek().catch(console.error);
    
    const elapsed = Date.now() - startTime;
    console.log(`\n✨ Scraping took ${formatTime(elapsed)}`);
})();