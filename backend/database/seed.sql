-- ============================================================================
-- Garage Management System — Seed Data
-- Database: garage_management_db
--
-- Populates the database with realistic sample data for development and demo.
-- Run AFTER schema.sql:
--   mysql -u garage_user -p garage_management_db < seed.sql
--
-- Password for ALL seeded users: Password123!
-- Hash below is bcrypt ($2b$) for "Password123!" — replace if using Argon2id.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- SERVICE BAYS
-- ============================================================================
INSERT INTO bay (bay_id, name, enabled) VALUES
(1, 'Bay 1 – General Service',   1),
(2, 'Bay 2 – General Service',   1),
(3, 'Bay 3 – Diagnostics',       1),
(4, 'Bay 4 – Tyre & Alignment',  1);

-- ============================================================================
-- CUSTOMERS
-- ============================================================================
INSERT INTO customer (customer_id, name, phone, email) VALUES
(1, 'James Mwangi',    '+254712345678', 'james.mwangi@example.com'),
(2, 'Aisha Odhiambo',  '+254723456789', 'aisha.odhiambo@example.com'),
(3, 'Peter Kamau',     '+254734567890', 'peter.kamau@example.com'),
(4, 'Grace Wanjiku',   '+254745678901', 'grace.wanjiku@example.com'),
(5, 'Daniel Otieno',   '+254756789012', NULL);

-- ============================================================================
-- USERS (login accounts)
-- bcrypt hash for "Password123!" — $2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe
-- ============================================================================
INSERT INTO `user` (user_id, customer_id, name, email, password_hash, role, active) VALUES
-- Customers (linked to customer profiles)
(1,  1, 'James Mwangi',     'james.mwangi@example.com',   '$2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe', 'CUSTOMER',     1),
(2,  2, 'Aisha Odhiambo',   'aisha.odhiambo@example.com', '$2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe', 'CUSTOMER',     1),
(3,  3, 'Peter Kamau',      'peter.kamau@example.com',    '$2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe', 'CUSTOMER',     1),
-- Staff (customer_id is NULL)
(4, NULL, 'Sarah Njeri',    'sarah.njeri@garage.local',    '$2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe', 'ADMIN',        1),
(5, NULL, 'John Kipchoge',  'john.kipchoge@garage.local',  '$2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe', 'RECEPTIONIST', 1),
(6, NULL, 'David Maina',    'david.maina@garage.local',    '$2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe', 'MECHANIC',     1),
(7, NULL, 'Michael Ouma',   'michael.ouma@garage.local',   '$2b$12$LJ3m4ys4Lz.qlPqGq1HkKeFg5vN3wXjKp0Zx1QOmYdW5bCsVnGKWe', 'MECHANIC',     1);

-- ============================================================================
-- VEHICLES
-- ============================================================================
INSERT INTO vehicle (vehicle_id, customer_id, registration_no, make, model, year, mileage) VALUES
(1, 1, 'KCA 123A', 'Toyota',     'Corolla',     2018, 85000),
(2, 1, 'KCB 456B', 'Nissan',     'Note',        2020, 42000),
(3, 2, 'KCC 789C', 'Subaru',     'Forester',    2017, 110000),
(4, 3, 'KCD 012D', 'Honda',      'Fit',         2019, 63000),
(5, 4, 'KCE 345E', 'Toyota',     'Land Cruiser', 2015, 180000),
(6, 5, 'KCF 678F', 'Mazda',      'Demio',       2021, 28000);

-- ============================================================================
-- SERVICE TASKS (reusable templates / service catalogue)
-- ============================================================================
INSERT INTO service_task (service_task_id, name, standard_hours) VALUES
(1, 'Oil Change',                     0.50),
(2, 'Brake Pad Replacement (Front)',  1.50),
(3, 'Brake Pad Replacement (Rear)',   1.50),
(4, 'Full Diagnostic Scan',           1.00),
(5, 'Tyre Rotation',                  0.75),
(6, 'Tyre Replacement (per tyre)',    0.50),
(7, 'Battery Replacement',            0.25),
(8, 'Air Filter Replacement',         0.25),
(9, 'Wheel Alignment',                1.00),
(10, 'Coolant Flush',                 1.00),
(11, 'Spark Plug Replacement',        1.50),
(12, 'Suspension Check',              1.00),
(13, 'AC Service & Regas',            2.00),
(14, 'Transmission Fluid Change',     1.50),
(15, 'Full Vehicle Service',          3.00);

-- ============================================================================
-- PARTS (catalogue with current prices in KES)
-- ============================================================================
INSERT INTO part (part_id, name, unit_price) VALUES
(1,  'Engine Oil 5W-30 (4L)',       3500.00),
(2,  'Oil Filter',                   800.00),
(3,  'Air Filter',                   1200.00),
(4,  'Front Brake Pads (set)',       4500.00),
(5,  'Rear Brake Pads (set)',        3800.00),
(6,  'Brake Disc (front)',           6500.00),
(7,  'Battery 12V 60Ah',            12000.00),
(8,  'Spark Plug (each)',            650.00),
(9,  'Coolant 1L',                   800.00),
(10, 'Transmission Fluid 1L',        1500.00),
(11, 'Windshield Wiper (pair)',      1800.00),
(12, 'Cabin Air Filter',             1500.00),
(13, 'Fuel Filter',                  2200.00),
(14, 'Drive Belt',                   3500.00),
(15, 'Tyre 195/65R15 (each)',        8500.00);

-- ============================================================================
-- BOOKINGS (sample appointments)
-- ============================================================================
INSERT INTO booking (booking_id, vehicle_id, bay_id, scheduled_at, ends_at, status, version) VALUES
(1, 1, 1, '2026-10-29 08:00:00', '2026-10-29 09:00:00', 'CONFIRMED', 1),
(2, 3, 2, '2026-10-29 09:00:00', '2026-10-29 11:00:00', 'PENDING',   1),
(3, 4, 3, '2026-10-30 10:00:00', '2026-10-30 11:00:00', 'PENDING',   1);

-- ============================================================================
-- JOB CARDS
-- ============================================================================
INSERT INTO job_card (job_card_id, vehicle_id, booking_id, mechanic_id, opened_at, status, version) VALUES
(1, 5, NULL, 6, '2026-10-27 09:30:00', 'COMPLETED', 3),
(2, 2, NULL, 7, '2026-10-28 08:00:00', 'IN_PROGRESS', 2);

-- ============================================================================
-- TASKS (performed on job cards)
-- ============================================================================
INSERT INTO task (task_id, job_card_id, name, standard_hours) VALUES
(1, 1, 'Oil Change',                 0.50),
(2, 1, 'Air Filter Replacement',     0.25),
(3, 1, 'Brake Pad Replacement (Front)', 1.50),
(4, 2, 'Full Diagnostic Scan',       1.00),
(5, 2, 'Spark Plug Replacement',     1.50);

-- ============================================================================
-- JOB PARTS (parts consumed, with price snapshot)
-- ============================================================================
INSERT INTO job_part (job_card_id, part_id, quantity, unit_price_snapshot) VALUES
(1, 1,  1, 3500.00),
(1, 2,  1,  800.00),
(1, 3,  1, 1200.00),
(1, 4,  1, 4500.00),
(2, 8,  4,  650.00);

-- ============================================================================
-- INVOICES
-- ============================================================================
INSERT INTO invoice (invoice_id, job_card_id, total_amount, currency, issued_at) VALUES
(1, 1, 13375.00, 'KES', '2026-10-27 14:00:00');

-- ============================================================================
-- INVOICE LINES (immutable snapshot of invoice items)
-- ============================================================================
INSERT INTO invoice_line (invoice_line_id, invoice_id, kind, description, quantity, unit_price, line_total) VALUES
(1, 1, 'LABOR', 'Oil Change',                      0.50, 1500.00,  750.00),
(2, 1, 'LABOR', 'Air Filter Replacement',           0.25, 1500.00,  375.00),
(3, 1, 'LABOR', 'Brake Pad Replacement (Front)',     1.50, 1500.00, 2250.00),
(4, 1, 'PART',  'Engine Oil 5W-30 (4L)',             1.00, 3500.00, 3500.00),
(5, 1, 'PART',  'Oil Filter',                        1.00,  800.00,  800.00),
(6, 1, 'PART',  'Air Filter',                        1.00, 1200.00, 1200.00),
(7, 1, 'PART',  'Front Brake Pads (set)',             1.00, 4500.00, 4500.00);
-- Labor total: 3,375.00 + Parts total: 10,000.00 = 13,375.00

-- ============================================================================
-- PAYMENTS (part-payments summing to total)
-- ============================================================================
INSERT INTO payment (payment_id, invoice_id, amount, paid_at, method, transaction_reference) VALUES
(1, 1, 8000.00, '2026-10-27 14:15:00', 'MOBILE_MONEY', 'MPESA_REC01ABC456'),
(2, 1, 5375.00, '2026-10-27 14:30:00', 'CASH',          NULL);

-- ============================================================================
-- AUDIT EVENTS (sample entries)
-- ============================================================================
INSERT INTO audit_event (audit_id, actor_user_id, action, resource_type, resource_id, occurred_at, request_id, outcome) VALUES
(1, 4, 'CREATE_USER',     'USER',     '6',  '2026-10-20 10:00:00', 'req-seed-001', 'SUCCESS'),
(2, 4, 'CREATE_USER',     'USER',     '7',  '2026-10-20 10:05:00', 'req-seed-002', 'SUCCESS'),
(3, 5, 'CREATE_JOB_CARD', 'JOB_CARD', '1',  '2026-10-27 09:30:00', 'req-seed-003', 'SUCCESS'),
(4, 6, 'UPDATE_STATUS',   'JOB_CARD', '1',  '2026-10-27 13:00:00', 'req-seed-004', 'SUCCESS'),
(5, 5, 'CREATE_INVOICE',  'INVOICE',  '1',  '2026-10-27 14:00:00', 'req-seed-005', 'SUCCESS'),
(6, 5, 'RECORD_PAYMENT',  'PAYMENT',  '1',  '2026-10-27 14:15:00', 'req-seed-006', 'SUCCESS');

SET FOREIGN_KEY_CHECKS = 1;
