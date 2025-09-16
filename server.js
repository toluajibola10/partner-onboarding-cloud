/* ───────────────────────────  server.js  ─────────────────────────── */
const express       = require('express');
const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs            = require('fs/promises');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORTAL_USER = process.env.PORTAL_EMAIL;
const PORTAL_PASS = process.env.PORTAL_PASSWORD;

/* ── helpers ─────────────────────────────────────────────────────── */
const selectByText = async (page, sel, txt) => {
  if (!txt) return;
  const val = await page.evaluate(({s, t}) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const opt = [...el.options].find(o =>
      o.textContent.toLowerCase().includes(t.toLowerCase())
    );
    return opt ? opt.value : null;
  }, {s: sel, t: txt});
  if (val) await page.select(sel, val);
};

const typeIfExists = async (page, selector, val) => {
  if (!val) return;
  try {
    await page.waitForSelector(selector, { visible:true, timeout:8000 });
    await page.type(selector, String(val));
  } catch {/* ignore */ }
};

const firstVisible = async (page, list, timeout = 10000) => {
  for (const sel of list) {
    try {
      await page.waitForSelector(sel, { visible:true, timeout });
      return sel;
    } catch {/* try next */ }
  }
  return null;
};

/* ── login ───────────────────────────────────────────────────────── */
const login = async page => {
  await page.goto('https://partner.distribusion.com/session/new', {
    waitUntil:'domcontentloaded', timeout:30000
  });
  await page.waitForTimeout(1500);           // handle possible redirect

  const emailSel = await firstVisible(page, [
    '#sign_in_email', '#user_email',
    'input[name="user[email]"]', 'input[type="email"]'
  ]);
  const passSel  = await firstVisible(page, [
    '#sign_in_password', '#user_password',
    'input[name="user[password]"]', 'input[type="password"]'
  ]);
  if (!emailSel || !passSel) throw new Error('Login form not found');

  await page.type(emailSel, PORTAL_USER, {delay:25});
  await page.type(passSel,  PORTAL_PASS, {delay:25});

  const submit = await page.$('form button[type="submit"], form input[type="submit"]');
  if (!submit) throw new Error('Login submit not found');

  await Promise.all([
    page.waitForNavigation({ waitUntil:'networkidle2', timeout:30000 }),
    submit.click(),
  ]);
  if (page.url().includes('session')) throw new Error('Login failed');
};

/* ── carrier group route ─────────────────────────────────────────── */
app.post('/api/carrier_groups', async (req, res) => {
  if (!PORTAL_USER || !PORTAL_PASS)
    return res.status(400).json({ success:false, error:'Missing credentials' });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless:'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width:1366, height:768 });

    await login(page);

    /* carrier-group form */
    await page.goto('https://partner.distribusion.com/carrier_groups/new?locale=en',
                    { waitUntil:'networkidle2' });
    await page.waitForSelector('input[name="carrier_group[name]"]',
                               { visible:true, timeout:15000 });

    const d = req.body;                       // shorthand
    await typeIfExists(page, 'input[name="carrier_group[name]"]',      d.carrier_group_name);
    await typeIfExists(page, 'input[name="carrier_group[address]"]',   d.carrier_group_address);
    await typeIfExists(page, 'input[name="carrier_group[vat_no]"]',    d.carrier_group_vat_no);
    await typeIfExists(page, 'input[name="carrier_group[iban]"]',      d.carrier_group_iban);
    await typeIfExists(page, 'input[name="carrier_group[bic]"]',       d.carrier_group_bic);
    if (d.carrier_group_country_code)
      await page.select('select[name="carrier_group[country_code]"]', d.carrier_group_country_code);

    await selectByText(page,'select[name="carrier_group[currency_id]"]',
                       d.carrier_group_currency_id);
    await selectByText(page,'select[name="carrier_group[invoicing_entity_id]"]',
                       d.carrier_group_invoicing_entity);
    await selectByText(page,'select[name="carrier_group[invoicing_cadence]"]',
                       d.carrier_group_invoicing_cadence);

    await Promise.all([
      page.waitForNavigation({ waitUntil:'networkidle2' }),
      page.click('form#new_carrier_group button.btn-success')
    ]);

    /* bail out early if validation failed */
    if (page.url().includes('/carrier_groups/new')) {
      const errors = await page.$$eval('.alert, .error', els =>
        els.map(e=>e.textContent.trim()).filter(Boolean));
      return res.status(422).json({ success:false, errors });
    }

    const groupId = page.url().match(/carrier_groups\/(\d+)/)?.[1] || null;
    res.json({ success:true, groupId });
  } catch (e) {
    res.status(500).json({ success:false, error:e.message });
  } finally { if (browser) await browser.close(); }
});

/* ── provider route ──────────────────────────────────────────────── */
app.post('/api/providers', async (req, res) => {
  if (!PORTAL_USER || !PORTAL_PASS)
    return res.status(400).json({ success:false, error:'Missing credentials' });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless:'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width:1366, height:768 });

    await login(page);

    /* provider form */
    await page.goto('https://partner.distribusion.com/providers/new?locale=en',
                    { waitUntil:'networkidle2', timeout:60000 });
    await page.waitForSelector('input[name="provider[display_name]"]',
                               { visible:true, timeout:15000 });

    const d = req.body;

    /* BASIC */
    await typeIfExists(page, 'input[name="provider[display_name]"]', d.provider_display_name);
    if (d.provider_group_id) {
      await page.select('select[name="provider[group_id]"]', d.provider_group_id);
      /* wait for contacts grid to load after selecting group */
      await page.waitForSelector('input[name="provider[contacts_attributes][0][first_name]"]',
                                 { visible:true, timeout:15000 });
    }
    await selectByText(page,'select[name="provider[revenue_stream_id]"]', d.provider_revenue_stream_type);
    await selectByText(page,'select[name="provider[status_id]"]',         d.provider_status);
    await selectByText(page,'select[name="provider[carrier_type_id]"]',   d.provider_carrier_type);

    /* LEGAL */
    await typeIfExists(page,'input[name="provider[legal_name]"]',            d.provider_legal_name);
    await typeIfExists(page,'input[name="provider[address]"]',               d.provider_address);
    if (d.provider_country_code)
      await page.select('select[name="provider[country_code]"]', d.provider_country_code);
    await typeIfExists(page,'input[name="provider[email]"]',                 d.provider_email);
    await typeIfExists(page,'input[name="provider[vat_no]"]',                d.provider_vat_no);
    await typeIfExists(page,'input[name="provider[iban]"]',                  d.provider_iban);
    await typeIfExists(page,'input[name="provider[bic]"]',                   d.provider_bic);
    await typeIfExists(page,'input[name="provider[authorised_representative]"]',
                       d.provider_authorised_representative);

    /* CONTACTS ─ business row (index 0) */
    await selectByText(page,
      'select[name="provider[contacts_attributes][0][contact_type]"]', 'Business');
    await typeIfExists(page,'input[name="provider[contacts_attributes][0][first_name]"]',
                       d.provider_business_contact_first_name);
    await typeIfExists(page,'input[name="provider[contacts_attributes][0][last_name]"]',
                       d.provider_business_contact_last_name);
    await typeIfExists(page,'input[name="provider[contacts_attributes][0][email]"]',
                       d.provider_business_contact_email);

    /* CONTACTS ─ technical row (index 1) */
    if (d.provider_technical_contact_first_name) {
      const add = await page.$('.add_nested_fields, a[data-association="contacts"]');
      if (add) {
        await add.click();
        await page.waitForSelector(
          'input[name="provider[contacts_attributes][1][first_name]"]',
          { visible:true, timeout:10000 });
      }
      await selectByText(page,
        'select[name="provider[contacts_attributes][1][contact_type]"]', 'Technical');
      await typeIfExists(page,'input[name="provider[contacts_attributes][1][first_name]"]',
                         d.provider_technical_contact_first_name);
      await typeIfExists(page,'input[name="provider[contacts_attributes][1][last_name]"]',
                         d.provider_technical_contact_last_name);
      await typeIfExists(page,'input[name="provider[contacts_attributes][1][email]"]',
                         d.provider_technical_contact_email);
    }

    /* DT CONTACT */
    await typeIfExists(page,'input[name="provider[contact_person]"]',
                       d.provider_contact_person);
    await typeIfExists(page,'input[name="provider[distribusion_account_manager]"]',
                       d.provider_contact_distribusion_account_manager);

    /* CONTRACT – wait for contract panel */
    await page.waitForSelector(
      'input[name="provider[contracts_attributes][0][effective_date]"]',
      { visible:true, timeout:15000 });
    await typeIfExists(page,'input[name="provider[contracts_attributes][0][effective_date]"]',
                       d.provider_contracts_attributes_effective_date);
    await typeIfExists(page,'input[name="provider[contracts_attributes][0][duration]"]',
                       d.provider_contracts_attributes_duration || '3 years');
    await typeIfExists(page,'input[name="provider[contracts_attributes][0][termination_notice]"]',
                       d.provider_contracts_attributes_termination_notice || '6 months');
    await typeIfExists(page,'input[name="provider[contracts_attributes][0][deposit_amount]"]',
                       d.provider_contracts_attributes_deposit_amount);
    await typeIfExists(page,'input[name="provider[contracts_attributes][0][contract_directory_url]"]',
                       d.provider_contracts_attributes_contract_directory_url);
    if (d.provider_contracts_attributes_checked_by_legal === 'yes') {
      const cb = await page.$('input[name="provider[contracts_attributes][0][checked_by_legal]"]');
      if (cb) await cb.click();
    }
    await selectByText(page,
      'select[name="provider[contracts_attributes][0][invoicing_entity_id]"]',
      d.provider_contracts_attributes_invoicing_entity);

    /* INVOICE */
    await selectByText(page,'select[name="provider[currency_id]"]',      d.provider_currency_id);
    await selectByText(page,'select[name="provider[invoicing_type_id]"]',d.provider_invoicing_type);
    await typeIfExists(page,'input[name="provider[email_for_invoicing]"]',
                       d.provider_email_for_invoicing);
    await selectByText(page,'select[name="provider[invoicing_cadence]"]',
                       d.provider_invoicing_cadence);

    /* COMMISSIONS & FEES */
    await typeIfExists(page,'input[name="provider[commission_affiliate_in_percent]"]',
                       d.provider_commission_rate_for_affiliate_partners);
    await typeIfExists(page,'input[name="provider[commission_stationary_in_percent]"]',
                       d.provider_commission_rate_for_stationary_agencies);
    await typeIfExists(page,'input[name="provider[commission_online_in_percent]"]',
                       d.provider_commission_rate_for_online_agencies);
    await typeIfExists(page,'input[name="provider[commission_white_label_in_percent]"]',
                       d.provider_commission_rate_for_ota_white_labels);
    await typeIfExists(page,'input[name="provider[commission_point_of_sale_in_percent]"]',
                       d.provider_commission_rate_for_points_of_sale);

    await typeIfExists(page,'input[name="provider[booking_transaction_fee_in_percent]"]',
                       d.provider_booking_transaction_fee_in_percent);
    await typeIfExists(page,'input[name="provider[transaction_fee_in_cents]"]',
                       d.provider_transaction_fee_in_cents);
    await typeIfExists(page,'input[name="provider[ancillary_transaction_fee_fixed_in_cents]"]',
                       d.provider_ancillary_transaction_fee_fixed_in_cents);
    await typeIfExists(page,'input[name="provider[ancillary_transaction_fee_in_percent]"]',
                       d.provider_ancillary_transaction_fee_in_percent);

    await typeIfExists(page,'input[name="provider[vat_rate_for_invoicing]"]',
                       d.provider_vat_rate_for_invoicing);
    await typeIfExists(page,'input[name="provider[payment_fee_owl]"]',
                       d.provider_payment_fee_owl);

    /* SUBMIT & error capture */
    await Promise.all([
      page.waitForNavigation({ waitUntil:'networkidle2' }),
      page.click('form#new_provider button[type="submit"]')
    ]);

    if (page.url().includes('/providers/new')) {
      const errors = await page.$$eval('.alert, .error', els =>
        els.map(e=>e.textContent.trim()).filter(Boolean));
      return res.status(422).json({ success:false, errors });
    }

    const providerId = page.url().match(/providers\/(\d+)/)?.[1] || null;
    res.json({ success:true, providerId, providerUrl:page.url() });
  } catch (e) {
    res.status(500).json({ success:false, error:e.message });
  } finally { if (browser) await browser.close(); }
});

/* ── health check ───────────────────────────────────────────────── */
app.get('/', (_req, res) => {
  res.json({ status:'running', credentialsLoaded:!!(PORTAL_USER && PORTAL_PASS) });
});

/* ── start ─────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
  console.log('Credentials loaded:', !!(PORTAL_USER && PORTAL_PASS));
});
/* ──────────────────────────────────────────────────────────────── */
