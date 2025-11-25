require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const pool = process.env.DB_URL
  ? mysql.createPool({
      uri: process.env.DB_URL,
      waitForConnections: true,
      connectionLimit: 10,
    })
  : mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'vaiexpress',
      waitForConnections: true,
      connectionLimit: 10,
    });

async function getBaseRate() {
  const [rows] = await pool.query('SELECT exchange_rate FROM settings WHERE id = 1');
  return rows.length ? Number(rows[0].exchange_rate) : 0;
}

function computeTotals(payload, baseRate) {
  const priceThb = Number(payload.price_thb || 0);
  const shipThb = Number(payload.shipping_thb || 0);
  const serviceFee = Number(payload.service_fee_lak || 0);
  const thToLaCharge = Number(payload.th_to_la_charge_lak || 0);
  const actualCost = Number(payload.actual_th_to_la_cost_lak || 0);
  const customerRate = Number(payload.customer_rate || baseRate);

  const priceLak = priceThb * customerRate;
  const shipLak = shipThb * customerRate;
  const totalLak = priceLak + shipLak + serviceFee + thToLaCharge;

  const rateProfitLak = (priceThb + shipThb) * (customerRate - baseRate);
  const costLak = (priceThb * baseRate) + (shipThb * baseRate) + actualCost;
  const netProfitLak = totalLak - costLak;

  return {
    price_thb: priceThb,
    shipping_thb: shipThb,
    customer_rate: customerRate,
    service_fee_lak: serviceFee,
    th_to_la_charge_lak: thToLaCharge,
    actual_th_to_la_cost_lak: actualCost,
    price_lak: priceLak,
    shipping_lak: shipLak,
    total_lak: totalLak,
    rate_profit_lak: rateProfitLak,
    net_profit_lak: netProfitLak,
  };
}

app.get('/', (req, res) => {
  res.send('VAIexpress Node service is running.');
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/stats/summary', async (req, res) => {
  try {
    const today = req.query.date || new Date().toISOString().slice(0, 10);
    const [year, month] = [today.slice(0, 4), today.slice(5, 7)];

    const [[{ rate = 0, updated_at = null } = {}]] =
      await pool.query('SELECT exchange_rate AS rate, updated_at FROM settings WHERE id = 1');

    const queries = [
      pool.query('SELECT SUM(total_lak) AS v FROM orders WHERE order_date = ?', [today]),
      pool.query('SELECT SUM(net_profit_lak) AS v FROM orders WHERE order_date = ?', [today]),
      pool.query('SELECT SUM(rate_profit_lak) AS v FROM orders WHERE order_date = ?', [today]),
      pool.query('SELECT COUNT(*) AS c FROM orders WHERE order_date = ?', [today]),
      pool.query('SELECT SUM(total_lak) AS v FROM orders WHERE YEAR(order_date)=? AND MONTH(order_date)=?', [year, month]),
      pool.query('SELECT SUM(net_profit_lak) AS v FROM orders WHERE YEAR(order_date)=? AND MONTH(order_date)=?', [year, month]),
      pool.query("SELECT COUNT(*) AS c FROM orders WHERE payment_status='Paid'"),
      pool.query("SELECT COUNT(*) AS c FROM orders WHERE payment_status='Unpaid'"),
      pool.query('SELECT COUNT(*) AS c FROM orders'),
      pool.query("SELECT SUM(total_lak) AS v FROM orders WHERE payment_status='Unpaid'"),
      pool.query('SELECT SUM(total_lak) AS v FROM orders'),
    ];

    const results = await Promise.all(queries);
    const [
      [{ v: today_total_lak = 0 }],
      [{ v: today_profit_total = 0 }],
      [{ v: today_rate_profit = 0 }],
      [{ c: today_orders_count = 0 }],
      [{ v: month_total_lak = 0 }],
      [{ v: month_profit_total = 0 }],
      [{ c: paid_orders_count = 0 }],
      [{ c: unpaid_orders_count = 0 }],
      [{ c: all_orders_count = 0 }],
      [{ v: unpaid_value_lak = 0 }],
      [{ v: gross_value_lak = 0 }],
    ] = results.map(([rows]) => rows);

    res.json({
      date: today,
      rate,
      rate_updated: updated_at,
      today: {
        total_lak: Number(today_total_lak || 0),
        profit_total: Number(today_profit_total || 0),
        rate_profit: Number(today_rate_profit || 0),
        other_profit: Number(today_profit_total || 0) - Number(today_rate_profit || 0),
        orders_count: Number(today_orders_count || 0),
      },
      month: {
        total_lak: Number(month_total_lak || 0),
        profit_total: Number(month_profit_total || 0),
        period: `${year}-${month}`,
      },
      payments: {
        paid_orders: Number(paid_orders_count || 0),
        unpaid_orders: Number(unpaid_orders_count || 0),
        unpaid_value_lak: Number(unpaid_value_lak || 0),
      },
      gross_value_lak: Number(gross_value_lak || 0),
      all_orders_count: Number(all_orders_count || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const [rows] = await pool.query(
      'SELECT id, order_date, customer_name, total_lak, net_profit_lak, payment_status, order_status, tracking_no, carrier FROM orders ORDER BY order_date DESC, id DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const baseRate = await getBaseRate();
    const fields = computeTotals(req.body, baseRate);

    const payload = {
      order_date: req.body.order_date || new Date().toISOString().slice(0, 10),
      customer_name: req.body.customer_name || '',
      product_link: req.body.product_link || '',
      payment_status: req.body.payment_status || 'Unpaid',
      order_status: req.body.order_status || 'Pending',
      tracking_no: req.body.tracking_no || '',
      carrier: req.body.carrier || '',
      tracking_link: req.body.tracking_link || '',
      rate: baseRate,
      ...fields,
    };

    const sql = `
      INSERT INTO orders
      (order_date, customer_name, product_link,
       price_thb, shipping_thb, rate, customer_rate, rate_profit_lak,
       price_lak, shipping_lak,
       service_fee_lak, th_to_la_charge_lak, actual_th_to_la_cost_lak,
       total_lak, net_profit_lak,
       payment_status, order_status,
       tracking_no, carrier, tracking_link)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    const params = [
      payload.order_date, payload.customer_name, payload.product_link,
      payload.price_thb, payload.shipping_thb, payload.rate, payload.customer_rate, payload.rate_profit_lak,
      payload.price_lak, payload.shipping_lak,
      payload.service_fee_lak, payload.th_to_la_charge_lak, payload.actual_th_to_la_cost_lak,
      payload.total_lak, payload.net_profit_lak,
      payload.payment_status, payload.order_status,
      payload.tracking_no, payload.carrier, payload.tracking_link,
    ];

    const [result] = await pool.query(sql, params);
    res.status(201).json({ id: result.insertId, ...payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const baseRate = await getBaseRate();
    const fields = computeTotals(req.body, baseRate);

    const payload = {
      order_date: req.body.order_date || new Date().toISOString().slice(0, 10),
      customer_name: req.body.customer_name || '',
      product_link: req.body.product_link || '',
      payment_status: req.body.payment_status || 'Unpaid',
      order_status: req.body.order_status || 'Pending',
      tracking_no: req.body.tracking_no || '',
      carrier: req.body.carrier || '',
      tracking_link: req.body.tracking_link || '',
      rate: baseRate,
      ...fields,
    };

    const sql = `
      UPDATE orders SET
        order_date=?, customer_name=?, product_link=?,
        price_thb=?, shipping_thb=?, rate=?, customer_rate=?, rate_profit_lak=?,
        price_lak=?, shipping_lak=?,
        service_fee_lak=?, th_to_la_charge_lak=?, actual_th_to_la_cost_lak=?,
        total_lak=?, net_profit_lak=?,
        payment_status=?, order_status=?,
        tracking_no=?, carrier=?, tracking_link=?
      WHERE id=?
    `;
    const params = [
      payload.order_date, payload.customer_name, payload.product_link,
      payload.price_thb, payload.shipping_thb, payload.rate, payload.customer_rate, payload.rate_profit_lak,
      payload.price_lak, payload.shipping_lak,
      payload.service_fee_lak, payload.th_to_la_charge_lak, payload.actual_th_to_la_cost_lak,
      payload.total_lak, payload.net_profit_lak,
      payload.payment_status, payload.order_status,
      payload.tracking_no, payload.carrier, payload.tracking_link,
      req.params.id,
    ];

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ id: Number(req.params.id), ...payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM orders WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`VAIexpress API listening on http://localhost:${PORT}`);
});
