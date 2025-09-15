// server.js  –  Render entry point
import 'dotenv/config.js';
import express from 'express';
import puppeteer from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
puppeteer.use(Stealth());

/* ───────── ENV  (set in Render’s dashboard) ───────── */
const {
  PORT            = 5000,
  VIEW_PORTAL     = 'https://partner.distribusion.com',
  PORTAL_EMAIL,
  PORTAL_PASSWORD,
  PUPPETEER_EXECUTABLE_PATH,            // provided by Dockerfile
} = process.env;

/* ───────── launch browser once & reuse ───────── */
let browser, page;
async function getPage() {
  if (page && !page.isClosed()) return page;

  browser ??= await puppeteer.launch({
    headless: true,
    executablePath: PUPPETEER_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 }
  });
  page = await browser.newPage();
  await login(page);
  return page;
}

/* ───────── portal login (runs once) ───────── */
async function login(p) {
  console.log('🔑 logging in …');
  await p.goto(`${VIEW_PORTAL}/session/new?locale=en`, { waitUntil: 'networkidle2' });

  // selectors verified 2025-09-15 – change here if portal updates
  await p.type('#user_email'   , PORTAL_EMAIL);
  await p.type('#user_password', PORTAL_PASSWORD);
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'networkidle2' }),
    p.click('input[type="submit"]')
  ]);

  if (!p.url().includes('/dashboard')) {
    throw new Error('❌ login failed – check credentials / selectors');
  }
  console.log('✅ logged in');
}

/* ───────── main worker per partner ───────── */
async function createPartner(data) {
  const p = await getPage();
  console.log(`🚀 creating partner “${data.partnerName}” …`);

  /* 1 — Carrier-group */
  await p.goto(`${VIEW_PORTAL}/carrier_groups/new?locale=en`, { waitUntil: 'networkidle2' });
  await p.type('#carrier_group_name'        , data.carrier_group_name);
  await p.type('#carrier_group_address'     , data.carrier_group_address);
  await p.type('#carrier_group_vat_no'      , data.carrier_group_vat_no);
  await p.type('#carrier_group_iban'        , data.carrier_group_iban);
  await p.type('#carrier_group_bic'         , data.carrier_group_bic);
  await p.select('#carrier_group_country_code' , data.carrier_group_country_code);
  await p.select('#carrier_group_currency_id'  , data.carrier_group_currency_id);
  await p.select('#carrier_group_invoicing_entity_id',
                 await optionByText(p,'#carrier_group_invoicing_entity_id',
                                    data.carrier_group_invoicing_entity));
  await p.select('#carrier_group_invoicing_cadence'  ,
                 await optionByText(p,'#carrier_group_invoicing_cadence',
                                    data.carrier_group_invoicing_cadence));

  await Promise.all([
    p.waitForNavigation({ waitUntil: 'networkidle2' }),
    p.click('form#new_carrier_group button[type="submit"]')
  ]);
  const groupId = p.url().match(/carrier_groups\/(\d+)/)[1];
  console.log('  ✔ carrier-group created id=', groupId);

  /* 2 — Provider */
  await p.goto(`${VIEW_PORTAL}/providers/new?locale=en`, { waitUntil: 'networkidle2' });
  const sel = (s,v)=>p.select(s,v);
  const typ = (s,v)=>p.type  (s,v || '');

  typ('#provider_display_name'                      , data.provider_display_name);
  sel('#provider_revenue_stream_type'               , data.provider_revenue_stream_type);
  sel('#provider_status'                            , data.provider_status);
  sel('#provider_carrier_type'                      , data.provider_carrier_type);
  sel('#provider_group_id'                          , groupId);

  typ('#provider_legal_name'                        , data.provider_legal_name);
  typ('#provider_address'                           , data.provider_address);
  sel('#provider_country_code'                      , data.provider_country_code);
  typ('#provider_email'                             , data.provider_email);
  typ('#provider_vat_no'                            , data.provider_vat_no);
  typ('#provider_iban'                              , data.provider_iban);
  typ('#provider_bic'                               , data.provider_bic);
  typ('#provider_authorised_representative'         , data.provider_authorised_representative);

  sel('#provider_currency_id'                       , data.provider_currency_id);
  sel('#provider_invoicing_type'                    , data.provider_invoicing_type);
  typ('#provider_email_for_invoicing'               , data.provider_email_for_invoicing);

  /* — commissions / fees / contract — */
  await p.evaluate((payload)=>{
      function set(name,val){document.querySelector(`[name="${name}"]`).value = val; }
      set('provider[commission_rate_for_online_agencies]'   , payload.provider_commission_rate_for_online_agencies);
      set('provider[commission_rate_for_ota_white_labels]'  , payload.provider_commission_rate_for_ota_white_labels);
      set('provider[commission_rate_for_points_of_sale]'    , payload.provider_commission_rate_for_points_of_sale);
      set('provider[commission_rate_for_affiliate_partners]', payload.provider_commission_rate_for_affiliate_partners);
      set('provider[commission_rate_for_stationary_agencies]',payload.provider_commission_rate_for_stationary_agencies);

      /* you can keep expanding with all additional fields here */
  }, data);

  await Promise.all([
    p.waitForNavigation({ waitUntil: 'networkidle2' }),
    p.click('form#new_provider button[type="submit"]')
  ]);
  console.log('  ✔ provider created');

  return groupId;
}

/* helper: <select> by visible text fragment ── */
async function optionByText(page, sel, fragment) {
  return page.evaluate(({ sel, fragment })=>{
    const el   = document.querySelector(sel) || {};
    fragment   = (fragment||'').toLowerCase();
    const opt  = [...el.options||[]].find(o=>o.textContent.toLowerCase().includes(fragment));
    return opt?.value || '';
  },{ sel, fragment });
}

/* ───────── EXPRESS WEB-API ───────── */
const app = express();
app.use(express.json({ limit:'1mb' }));

// health-check
app.get('/', (_req,res)=>res.send('👋 partner-onboarding API running'));

// main webhook route called from n8n
app.post('/partner', async (req,res)=>{
  try{
    const payload = req.body;
    if(!payload.partnerName && !payload.provider_display_name){
      return res.status(400).json({error:'payload looks empty'});
    }
    console.log('📦 received payload for', payload.partnerName || payload.provider_display_name);
    const groupId = await createPartner(payload);
    res.json({status:'ok', groupId});
  }catch(err){
    console.error(err);
    res.status(500).json({error: err.message});
  }
});

app.listen(PORT, ()=>console.log(`🚂 listening on :${PORT}`));
