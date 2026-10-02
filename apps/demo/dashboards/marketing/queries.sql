-- name: spend_by_channel
-- source: marketing
SELECT channel, SUM(spend) AS spend, SUM(clicks) AS clicks
FROM ad_spend
WHERE date >= date(:from) AND date < date(:to)
GROUP BY channel;

-- name: revenue_by_channel
-- source: shop
-- description: Paid revenue from customers, by the channel that first brought them
SELECT c.acquisition_channel AS channel, SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY c.acquisition_channel;

-- name: signups_by_channel
-- source: shop
SELECT acquisition_channel AS channel, COUNT(*) AS new_customers
FROM customers
WHERE signed_up_at >= :from AND signed_up_at < :to
GROUP BY acquisition_channel;

-- name: channel_return
-- uses: spend_by_channel, revenue_by_channel, signups_by_channel
-- description: Ad spend (marketing) against revenue and sign-ups (shop), per paid channel
SELECT s.channel,
       s.spend,
       r.revenue,
       r.revenue / s.spend AS roas,
       s.spend / n.new_customers AS cost_per_customer
FROM spend_by_channel s
LEFT JOIN revenue_by_channel r USING (channel)
LEFT JOIN signups_by_channel n USING (channel)
ORDER BY roas DESC;

-- name: totals
-- uses: channel_return
SELECT SUM(spend) AS spend, SUM(revenue) AS revenue, SUM(revenue) / SUM(spend) AS roas
FROM channel_return;

-- name: spend_by_week
-- source: marketing
SELECT date(date, 'weekday 1', '-7 days') AS week, channel, SUM(spend) AS spend
FROM ad_spend
WHERE date >= date(:from) AND date < date(:to)
GROUP BY week, channel;

-- name: revenue_by_week
-- source: shop
SELECT date(o.ordered_at, 'weekday 1', '-7 days') AS week,
       c.acquisition_channel AS channel,
       SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY week, c.acquisition_channel;

-- name: return_by_week
-- uses: spend_by_week, revenue_by_week
SELECT s.week, s.channel, r.revenue / s.spend AS roas
FROM spend_by_week s
JOIN revenue_by_week r USING (week, channel)
ORDER BY s.week, s.channel;
