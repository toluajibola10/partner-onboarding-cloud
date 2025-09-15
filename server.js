const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

// Environment Variables - FIXED NAMES
const PORTAL_USERNAME = process.env.PARTNER_PORTAL_USER;
const PORTAL_PASSWORD = process.env.PARTNER_PORTAL_PASS;

// Debug endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'API running',
    hasCredentials: !!(PORTAL_USERNAME && PORTAL_PASSWORD),
    credentialsLength: {
      username: PORTAL_USERNAME?.length || 0,
      password: PORTAL_PASSWORD?.length || 0
    }
  });
});

// Create Carrier Group
app.post('/api/carrier_groups', async (req, res) => {
  const data = req.body;
  console.log('Starting carrier group creation...');
  console.log('Username provided:', PORTAL_USERNAME ? 'Yes' : 'No');
  console.log('Password provided:', PORTAL_PASSWORD ? 'Yes' : 'No');
  
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({
      success: false,
      error: 'Missing portal credentials in environment variables'
    });
  }
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    
    console.log('Navigating to login page...');
    await page.goto('https://partner.distribusion.com/session/new?locale=en', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Take screenshot for debugging
    await page.screenshot({ path: '/tmp/login-page.png' });
    console.log('Screenshot taken');
    
    // Log current URL and title
    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());
    
    // Check if we're already logged in or redirected
    if (!page.url().includes('session')) {
      console.log('May already be logged in or redirected');
    }
    
    // Wait for either login form or dashboard
    try {
      await page.waitForSelector('#user_email, .dashboard, input[type="email"]', { 
        timeout: 10000 
      });
    } catch (e) {
      console.log('No login form or dashboard found');
      const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 1000));
      console.log('Page HTML preview:', bodyHTML);
      throw new Error('Cannot find login form or dashboard');
    }
    
    // Check if login form exists
    const hasLoginForm = await page.$('#user_email') !== null;
    
    if (hasLoginForm) {
      console.log('Login form found, attempting login...');
      await page.type('#user_email', PORTAL_USERNAME);
      await page.type('#user_password', PORTAL_PASSWORD);
      
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('button[type="submit"]')
      ]);
      
      console.log('Login submitted');
    } else {
      console.log('No login form, checking if already authenticated...');
    }
    
    // Rest of your carrier group creation code...
    
    res.json({ 
      success: true, 
      message: 'Process completed - check logs' 
    });
    
  } catch (error) {
    console.error('Detailed error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Credentials loaded:', !!(PORTAL_USERNAME && PORTAL_PASSWORD));
});