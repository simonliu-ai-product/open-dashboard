-- name: sample
-- description: Paid revenue per category, last 90 days against the 90 before
SELECT p.category,
       CASE WHEN o.ordered_at >= date('now', '-90 days') THEN '近 90 天' ELSE '前 90 天' END AS period,
       SUM(i.quantity * i.unit_price) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid' AND o.ordered_at >= date('now', '-180 days')
GROUP BY p.category, period
ORDER BY period DESC, p.category;
