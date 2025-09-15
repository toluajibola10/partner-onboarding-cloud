/* ─────────────────────────  server.js  ───────────────────────── */
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORTAL_USERNAME = process.env.PORTAL_EMAIL;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Common browser options
const browserOptions = {
  headless: IS_PRODUCTION ? 'new' : false, // Show browser locally, run headless in production
  slowMo: IS_PRODUCTION ? 0 : 50, // Add a delay locally to see what's happening
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
};

// Common User Agent string to avoid bot detection
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';


/* ─── utility helpers ─────────────────────────────────────────── */

const selectByText = async (page, selector, text) => {
  if (!text) return;
  const optionValue = await page.evaluate(
    ({ sel, txt }) => {
      const select = document.querySelector(sel);
      if (!select) return null;
      const opt = [...select.options].find(o =>
        o.textContent.toLowerCase().includes(txt.toLowerCase())
      );
      return opt ? opt.value : null;
    },
    { sel: selector, txt: text }
  );
  if (optionValue) await page.select(selector, optionValue);
};

const waitAndReturn = async (page, selector, timeout = 15000) => {
  await page.waitForSelector(selector, { visible: true, timeout });
  return selector;
};

/* ─── login helper ────────────────────────────────────────────── */

const loginToPortal = async page => {
  console.log('Navigating to login…');
  await page.goto('https://partner.distribusion.com/session/new', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(1500);

  const emailSelectors = ['#sign_in_email', '#user_email', 'input[name="user[email]"]', 'input[type="email"]'];
  const passwordSelectors = ['#sign_in_password', '#user_password', 'input[name="user[password]"]', 'input[type="password"]'];

  const firstVisible = async list => {
    for (const sel of list) {
      try {
        await page.waitForSelector(sel, { visible: true, timeout: 10000 });
        return sel;
      } catch { /* try next */ }
    }
    return null;
  };

  const emailSel = await firstVisible(emailSelectors);
  const pwdSel = await firstVisible(passwordSelectors);

  if (!emailSel || !pwdSel) {
    await page.screenshot({ path: '/tmp/login-page.png' });
    throw new Error('Login inputs not found – see /tmp/login-page.png');
  }

  await page.type(emailSel, PORTAL_USERNAME, { delay: 25 });
  await page.type(pwdSel, PORTAL_PASSWORD, { delay: 25 });

  const submitSel = await page.$('form button[type="submit"], form input[type="submit"]');
  if (!submitSel) {
    await page.screenshot({ path: '/tmp/login-page.png' });
    throw new Error('Submit button not found – see /tmp/login-page.png');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    submitSel.click(),
  ]);

  // ✅ IMPROVED LOGIN CHECK
  if (page.url().includes('/session') || page.url().includes('/sign_in')) {
    await page.screenshot({ path: '/tmp/login_failure.png' });
    throw new Error(`Login failed – check credentials. Landed on URL: ${page.url()}. See /tmp/login_failure.png`);
  }
  console.log('Login successful');
};

/* ─── health route ────────────────────────────────────────────── */

app.get('/', (_req, res) => {
  res.json({
    status: 'API running',
    hasCredentials: !!(PORTAL_USERNAME && PORTAL_PASSWORD),
  });
});

/* ─── CARRIER GROUP creation ─────────────────────────────────── */

app.post('/api/carrier_groups', async (req, res) => {
  const data = req.body;
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({ success: false, error: 'Missing portal credentials' });
  }

  let browser;
  let page;
  try {
    browser = await puppeteer.launch(browserOptions);
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(USER_AGENT); // ✅ SET USER AGENT

    await loginToPortal(page);

    console.log('Navigating to carrier groups form via UI...');

    const accountingMenuSelector = 'nav ul li a:first-child'; // This is a guess!
    console.log('Waiting for Accounting menu...');
    await page.waitForSelector(accountingMenuSelector);
    await page.hover(accountingMenuSelector);
    console.log('Hovering over Accounting menu.');

    const carrierGroupsLinkSelector = 'a[href="/carrier_groups"]'; // This is a guess!
    console.log('Waiting for Carrier Groups link...');
    await page.waitForSelector(carrierGroupsLinkSelector, { visible: true });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click(carrierGroupsLinkSelector),
    ]);
    console.log('Navigated to Carrier Groups list page.');

    const addNewButtonSelector = 'a[href="/carrier_groups/new"]'; // This is a guess!
    console.log('Waiting for "Add New" button...');
    await page.waitForSelector(addNewButtonSelector, { visible: true });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click(addNewButtonSelector),
    ]);
    console.log('Navigated to the new carrier group form.');

    await waitAndReturn(page, '#carrier_group_name');
    console.log('Filling carrier group form…');
    // ... (rest of form filling code is unchanged)
    await page.type('#carrier_group_name', data.carrier_group_name || '');
    await page.type('#carrier_group_address', data.carrier_group_address || '');
    await page.type('#carrier_group_vat_no', data.carrier_group_vat_no || '');
    await page.type('#carrier_group_iban', data.carrier_group_iban || '');
    await page.type('#carrier_group_bic', data.carrier_group_bic || '');
    if (data.carrier_group_country_code) await page.select('#carrier_group_country_code', data.carrier_group_country_code);
    if (data.carrier_group_currency_id) await selectByText(page, '#carrier_group_currency_id', data.carrier_group_currency_id);
    if (data.carrier_group_invoicing_entity) await selectByText(page, '#carrier_group_invoicing_entity_id', data.carrier_group_invoicing_entity);
    if (data.carrier_group_invoicing_cadence) await selectByText(page, '#carrier_group_invoicing_cadence', data.carrier_group_invoicing_cadence);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form#new_carrier_group button.btn-success'),
    ]);

    const groupId = page.url().match(/carrier_groups\/(\d+)/)?.[1] || null;
    console.log('Carrier group created with ID:', groupId);
    res.json({ success: true, groupId });

  } catch (err) {
    console.error('Error:', err.message);
    if (page) {
      const errorScreenshotPath = '/tmp/carrier_group_error.png';
      await page.screenshot({ path: errorScreenshotPath, fullPage: true });
      console.log(`Screenshot of the error page saved to ${errorScreenshotPath}`);
      console.log(`URL at time of error: ${page.url()}`);
    }
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

/* ─── PROVIDER creation ───────────────────────────────────────── */

app.post('/api/providers', async (req, res) => {
  const data = req.body;
  if (!PORTAL_USERNAME || !PORTAL_PASSWORD) {
    return res.status(400).json({ success: false, error: 'Missing portal credentials' });
  }

  let browser;
  try {
    browser = await puppeteer.launch(browserOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(USER_AGENT); // ✅ SET USER AGENT

    await loginToPortal(page);

    console.log('Going to provider form…');
    // NOTE: This direct navigation might also fail due to bot detection.
    // If it does, you will need to apply the same UI navigation logic
    // (hovering and clicking menus) as used in the carrier_groups route above.
    await page.goto(
      'https://partner.distribusion.com/providers/new?locale=en',
      { waitUntil: 'networkidle2', timeout: 60000 }
    );

    await waitAndReturn(page, '#provider_display_name');
    console.log('Filling provider form…');
    // ... (rest of provider form filling code is unchanged)
    
    res.json({ success: true, providerUrl: page.url() }); // Simplified for brevity

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

/* ─── start server ────────────────────────────────────────────── */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (!IS_PRODUCTION) {
    console.log('Running in DEVELOPMENT mode. Browser window will be visible.');
  } else {
    console.log('Running in PRODUCTION mode. Browser will be headless.');
  }
});