const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORTAL_USERNAME = process.env.PORTAL_EMAIL;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;

// Helper function to select dropdown by text
const selectByText = async (page, selector, text) => {
  if (!text) return;
  const optionValue = await page.evaluate((sel, txt) => {
    const select = document.querySelector(sel);
    if (!select) return null;
    const option = Array.from(select.options).find(opt =>
      opt.textContent.toLowerCase().includes(txt.toLowerCase())
    );
    return option?.value;
  }, selector, text);
  
  if (optionValue) {
    await page.select(selector, optionValue);
  }
};

// Helper function to type only if field exists
const typeIfExists = async (page, selector, text, timeout = 5000) => {
  if (text === undefined || text === null || text === '') return;
  try {
    await page.waitForSelector(selector, { visible: true, timeout: timeout });
    await page.type(selector, String(text));
    console.log(`✓ Filled ${selector}`);
  } catch (error) {
    console.warn(`Could not find selector "${selector}", skipping.`);
  }
};

// Helper function to login
const loginToPortal = async (page) => {
  console.log('Navigating to login...');
  await page.goto('https://partner.distribusion.com/session/new', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForTimeout(1500);

  const emailSelectors = [
    '#sign_in_email',
    '#user_email',
    'input[name="user[email]"]',
    'input[type="email"]'
  ];

  const passwordSelectors = [
    '#sign_in_password',
    '#user_password',
    'input[name="user[password]"]',
    'input[type="password"]'
  ];

  // Helper that resolves to the first selector that appears
  const firstVisible = async (list) => {
    for (const sel of list) {
      try {
        await page.waitForSelector(sel, { timeout: 10000, visible: true });
        return sel;
      } catch { /* try next */ }
    }
    return null;
  };

  const emailSel = await firstVisible(emailSelectors);
  const pwdSel = await firstVisible(passwordSelectors);

  if (!emailSel) {
    throw new Error('Email input not found');
  }
  if (!pwdSel) {
    throw new Error('Password input not found');
  }

  await page.type(emailSel, PORTAL_USERNAME, { delay: 25 });
  await page.type(pwdSel, PORTAL_PASSWORD, { delay: 25 });

  const submitSel = await page.$('form button[type="submit"], form input[type="submit"]');
  if (!submitSel) {
    throw new Error('Submit button not found');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    submitSel.click(),
  ]);

  if (page.url().includes('session/new') || page.url().includes('users/sign_in')) {
    throw new Error('Login failed - double-check credentials');
  }
  console.log('Login successful');
};

app.get('/', (req, res) => {
  res.json({
    status: 'API running',
    hasCredentials: !!(PORTAL_USERNAME && PORTAL_PASSWORD)
  });
});

// CARRIER GROUP CREATION (WORKING VERSION)
app.post('/api/carrier_groups', async (req, res) => {
  const data = req.body;
  
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({
      success: false,
      error: 'Missing portal credentials'
    });
  }
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    
    await loginToPortal(page);
    
    console.log('Going to carrier groups form...');
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en', {
      waitUntil: 'networkidle2'
    });
    
    console.log('Filling carrier group form...');
    await page.type('#carrier_group_name', data.carrier_group_name || '');
    await page.type('#carrier_group_address', data.carrier_group_address || '');
    await page.type('#carrier_group_vat_no', data.carrier_group_vat_no || '');
    await page.type('#carrier_group_iban', data.carrier_group_iban || '');
    await page.type('#carrier_group_bic', data.carrier_group_bic || '');
    
    if (data.carrier_group_country_code) {
      await page.select('#carrier_group_country_code', data.carrier_group_country_code);
    }
    
    if (data.carrier_group_currency_id) {
      await selectByText(page, '#carrier_group_currency_id', data.carrier_group_currency_id);
    }
    
    if (data.carrier_group_invoicing_entity) {
      await selectByText(page, '#carrier_group_invoicing_entity_id', data.carrier_group_invoicing_entity);
    }
    
    if (data.carrier_group_invoicing_cadence) {
      await selectByText(page, '#carrier_group_invoicing_cadence', data.carrier_group_invoicing_cadence);
    }
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_carrier_group button.btn-success')
    ]);
    
    const url = page.url();
    const groupIdMatch = url.match(/carrier_groups\/(\d+)/);
    const groupId = groupIdMatch ? groupIdMatch[1] : null;
    
    console.log('Carrier group created with ID:', groupId);
    res.json({ success: true, groupId: groupId });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser) await browser.close();
  }
});

// PROVIDER CREATION - DEBUG VERSION
app.post('/api/providers', async (req, res) => {
  const data = req.body;
  
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({ success: false, error: 'Missing portal credentials' });
  }
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false, // Set to false to watch what happens
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    
    await loginToPortal(page);
    
    console.log('Going to provider form...');
    await page.goto('https://partner.distribusion.com/providers/new?locale=en', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // DEBUG: Wait and check what fields actually exist
    await page.waitForTimeout(5000);
    console.log('=== DEBUGGING FIELD PRESENCE ===');
    
    // Check which basic fields exist
    const fieldsToCheck = [
      '#provider_display_name',
      '#provider_group_id',
      '#provider_revenue_stream_id',
      '#provider_revenue_stream_type',
      '#provider_status_id',
      '#provider_status',
      '#provider_carrier_type_id',
      '#provider_carrier_type',
      '#provider_legal_name',
      '#provider_contacts_attributes_0_first_name',
      '#provider_contracts_attributes_0_effective_date',
      '#provider_commission_affiliate_in_percent',
      '#provider_commission_rate_for_affiliate_partners'
    ];
    
    for (const selector of fieldsToCheck) {
      const exists = await page.$(selector) !== null;
      console.log(`${selector}: ${exists ? '✓ EXISTS' : '✗ NOT FOUND'}`);
    }
    
    // DEBUG: Get ALL input field IDs on the page
    console.log('\n=== ALL INPUT/SELECT/TEXTAREA FIELD IDs ON PAGE ===');
    const allFieldIds = await page.evaluate(() => {
      const fields = document.querySelectorAll('input[id], select[id], textarea[id]');
      return Array.from(fields).map(el => ({
        id: el.id,
        type: el.tagName.toLowerCase(),
        name: el.name || ''
      })).filter(item => item.id);
    });
    
    console.log('Total fields found:', allFieldIds.length);
    allFieldIds.forEach(field => {
      console.log(`  ${field.type}#${field.id} (name: ${field.name})`);
    });
    
    // DEBUG: Look specifically for commission fields
    console.log('\n=== COMMISSION FIELDS SEARCH ===');
    const commissionFields = allFieldIds.filter(field => 
      field.id.includes('commission') || 
      field.id.includes('affiliate') || 
      field.id.includes('stationary')
    );
    console.log('Commission-related fields:', commissionFields);
    
    // DEBUG: Look for contract fields
    console.log('\n=== CONTRACT FIELDS SEARCH ===');
    const contractFields = allFieldIds.filter(field => 
      field.id.includes('contract') || 
      field.id.includes('effective') || 
      field.id.includes('duration')
    );
    console.log('Contract-related fields:', contractFields);
    
    // DEBUG: Look for contact fields
    console.log('\n=== CONTACT FIELDS SEARCH ===');
    const contactFields = allFieldIds.filter(field => 
      field.id.includes('contact') || 
      field.id.includes('first_name') || 
      field.id.includes('last_name')
    );
    console.log('Contact-related fields:', contactFields);
    
    // Take a screenshot of the form
    await page.screenshot({ path: 'provider-form-debug.png', fullPage: true });
    console.log('Screenshot saved as provider-form-debug.png');
    
    // Now try to fill the form with what we know exists
    console.log('\n=== ATTEMPTING TO FILL BASIC FIELDS ===');
    
    // Fill basic fields that should definitely exist
    if (await page.$('#provider_display_name')) {
      await page.type('#provider_display_name', data.provider_display_name || '');
      console.log('✓ Filled display name');
    } else {
      console.log('✗ Could not find #provider_display_name');
    }
    
    if (await page.$('#provider_group_id')) {
      await page.select('#provider_group_id', String(data.provider_group_id || ''));
      console.log('✓ Selected group ID:', data.provider_group_id);
    } else {
      console.log('✗ Could not find #provider_group_id');
    }
    
    // Try different patterns for revenue stream
    const revenuePatterns = [
      '#provider_revenue_stream_id',
      '#provider_revenue_stream_type',
      '#provider_revenue_stream'
    ];
    
    let foundRevenue = false;
    for (const pattern of revenuePatterns) {
      if (await page.$(pattern)) {
        await selectByText(page, pattern, data.provider_revenue_stream_type);
        console.log(`✓ Found and filled revenue stream with ${pattern}`);
        foundRevenue = true;
        break;
      }
    }
    if (!foundRevenue) {
      console.log('✗ Could not find any revenue stream field');
    }
    
    // Try filling legal name
    if (await page.$('#provider_legal_name')) {
      await page.type('#provider_legal_name', data.provider_legal_name || '');
      console.log('✓ Filled legal name');
    } else {
      console.log('✗ Could not find #provider_legal_name');
    }
    
    // Check if we can find ANY contact fields using various patterns
    console.log('\n=== CHECKING CONTACT FIELD PATTERNS ===');
    const contactPatterns = [
      'input[name*="contacts"][name*="first_name"]',
      'input[id*="contacts"][id*="first_name"]',
      '.provider_contacts_row input',
      'table input[placeholder*="First"]'
    ];
    
    for (const pattern of contactPatterns) {
      const elements = await page.$$(pattern);
      if (elements.length > 0) {
        console.log(`✓ Found ${elements.length} elements with pattern: ${pattern}`);
      }
    }
    
    console.log('\n=== DEBUG COMPLETE ===');
    console.log('Check the console output above to see actual field IDs.');
    console.log('Browser will stay open for 30 seconds for manual inspection.');
    
    // Don't submit yet - just return debug info
    res.json({
      success: false,
      message: 'Debug mode - check server console for field analysis',
      foundFields: allFieldIds.length,
      debugInfo: {
        totalFields: allFieldIds.length,
        commissionFieldsCount: commissionFields.length,
        contractFieldsCount: contractFields.length,
        contactFieldsCount: contactFields.length
      }
    });
    
    // Keep browser open for inspection
    await new Promise(resolve => setTimeout(resolve, 30000));
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Credentials loaded:', !!(PORTAL_USERNAME && PORTAL_PASSWORD));
});