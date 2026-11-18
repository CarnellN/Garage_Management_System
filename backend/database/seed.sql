-- ============================================================================
-- Garage Management System — Seed Data
-- Database: garage_management_db
--
-- Realistic sample data for development and demos. Run AFTER schema.sql on an
-- empty database (see backend/database/README.md):
--   mysql -u garage_user -p garage_management_db -e "source backend/database/seed.sql"
--
-- Password for ALL seeded users: Password123!
-- Hash below is scrypt (N=32768, r=8, p=1) for "Password123!", in the format produced by
-- hashPassword() in backend/server/src/api/security.js. Regenerate with that function if changed.
--
-- DATES ARE RELATIVE TO THE DAY YOU LOAD THIS FILE, so there are always past
-- visits, work in progress today, and upcoming appointments:
--   @ago_N = N days ago, @day_0 = today, @in_N = N days ahead (Nairobi calendar).
--   Each @ variable is midnight Africa/Nairobi expressed in UTC, so
--   `@in_2 + INTERVAL '08:00' HOUR_MINUTE` means 08:00 Nairobi time two days from now.
--   The server stores and reads every DATETIME as UTC.
--   The garage is closed on Sundays, so a day that lands on a Sunday moves one day
--   further from today (back to Saturday for past days, on to Monday for future days).
--
-- Invoice labour lines use LABOR_HOURLY_RATE = 1000.00 KES/hour (as in .env.example),
-- computed exactly as the server does: standard_hours x rate, parts at their snapshot price.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- DATE ANCHORS
-- ============================================================================
SET @today = DATE(UTC_TIMESTAMP() + INTERVAL 3 HOUR);  -- today's date in Nairobi
SET @ago_150  = TIMESTAMP(DATE_SUB(@today, INTERVAL (150 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 150 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_120  = TIMESTAMP(DATE_SUB(@today, INTERVAL (120 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 120 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_95   = TIMESTAMP(DATE_SUB(@today, INTERVAL (95 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 95 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_81   = TIMESTAMP(DATE_SUB(@today, INTERVAL (81 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 81 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_67   = TIMESTAMP(DATE_SUB(@today, INTERVAL (67 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 67 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_60   = TIMESTAMP(DATE_SUB(@today, INTERVAL (60 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 60 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_53   = TIMESTAMP(DATE_SUB(@today, INTERVAL (53 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 53 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_46   = TIMESTAMP(DATE_SUB(@today, INTERVAL (46 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 46 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_39   = TIMESTAMP(DATE_SUB(@today, INTERVAL (39 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 39 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_32   = TIMESTAMP(DATE_SUB(@today, INTERVAL (32 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 32 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_25   = TIMESTAMP(DATE_SUB(@today, INTERVAL (25 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 25 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_22   = TIMESTAMP(DATE_SUB(@today, INTERVAL (22 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 22 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_20   = TIMESTAMP(DATE_SUB(@today, INTERVAL (20 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 20 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_18   = TIMESTAMP(DATE_SUB(@today, INTERVAL (18 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 18 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_16   = TIMESTAMP(DATE_SUB(@today, INTERVAL (16 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 16 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_14   = TIMESTAMP(DATE_SUB(@today, INTERVAL (14 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 14 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_10   = TIMESTAMP(DATE_SUB(@today, INTERVAL (10 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 10 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_7    = TIMESTAMP(DATE_SUB(@today, INTERVAL (7 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 7 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_5    = TIMESTAMP(DATE_SUB(@today, INTERVAL (5 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 5 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @ago_3    = TIMESTAMP(DATE_SUB(@today, INTERVAL (3 + (DAYOFWEEK(DATE_SUB(@today, INTERVAL 3 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @day_0    = TIMESTAMP(DATE_SUB(@today, INTERVAL (DAYOFWEEK(@today) = 1) DAY)) - INTERVAL 3 HOUR;
SET @in_2     = TIMESTAMP(DATE_ADD(@today, INTERVAL (2 + (DAYOFWEEK(DATE_ADD(@today, INTERVAL 2 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @in_4     = TIMESTAMP(DATE_ADD(@today, INTERVAL (4 + (DAYOFWEEK(DATE_ADD(@today, INTERVAL 4 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @in_6     = TIMESTAMP(DATE_ADD(@today, INTERVAL (6 + (DAYOFWEEK(DATE_ADD(@today, INTERVAL 6 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @in_9     = TIMESTAMP(DATE_ADD(@today, INTERVAL (9 + (DAYOFWEEK(DATE_ADD(@today, INTERVAL 9 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @in_13    = TIMESTAMP(DATE_ADD(@today, INTERVAL (13 + (DAYOFWEEK(DATE_ADD(@today, INTERVAL 13 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;
SET @in_20    = TIMESTAMP(DATE_ADD(@today, INTERVAL (20 + (DAYOFWEEK(DATE_ADD(@today, INTERVAL 20 DAY)) = 1)) DAY)) - INTERVAL 3 HOUR;

-- ============================================================================
-- SERVICE BAYS
-- Bay 5 is disabled: it is never offered for bookings.
-- ============================================================================
INSERT INTO bay (bay_id, name, enabled) VALUES
(1, 'Bay 1 – General Service',                 1),
(2, 'Bay 2 – General Service',                 1),
(3, 'Bay 3 – Diagnostics',                     1),
(4, 'Bay 4 – Tyre & Alignment',                1),
(5, 'Bay 5 – Bodywork (closed for repairs)',   0);

-- ============================================================================
-- CUSTOMERS
-- Customers 5, 8 and 11 have no login account (walk-ins managed by reception).
-- ============================================================================
INSERT INTO customer (customer_id, name, phone, email) VALUES
(1,  'James Mwangi',                    '+254712345678', 'james.mwangi@example.com'),
(2,  'Aisha Odhiambo',                  '+254723456789', 'aisha.odhiambo@example.com'),
(3,  'Peter Kamau',                     '+254734567890', 'peter.kamau@example.com'),
(4,  'Grace Wanjiku',                   '+254745678901', 'grace.wanjiku@example.com'),
(5,  'Daniel Otieno',                   '+254756789012', NULL),
(6,  'Mary Akinyi',                     '+254767890123', 'mary.akinyi@example.com'),
(7,  'Kevin Ochieng',                   '+254778901234', 'kevin.ochieng@example.com'),
(8,  'Lucy Chebet',                     '+254789012345', NULL),
(9,  'Joseph Mutua (Mutua Logistics)',  '+254790123456', 'joseph.mutua@example.com'),
(10, 'Naliaka Wekesa',                  '+254701234567', 'naliaka.wekesa@example.com'),
(11, 'Ahmed Hassan',                    '+254711223344', 'ahmed.hassan@example.com'),
(12, 'Wanjiru Kariuki',                 '+254722334455', 'wanjiru.kariuki@example.com');

-- ============================================================================
-- USERS (login accounts)
-- scrypt hash for "Password123!" (see header note).
-- Samuel Njoroge (11) is a former mechanic: deactivated, so he cannot log in, but his past job cards remain.
-- ============================================================================
INSERT INTO `user` (user_id, customer_id, name, email, password_hash, role, active) VALUES
-- Customers (linked to customer profiles)
(1,  1,    'James Mwangi',    'james.mwangi@example.com',      'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(2,  2,    'Aisha Odhiambo',  'aisha.odhiambo@example.com',    'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(3,  3,    'Peter Kamau',     'peter.kamau@example.com',       'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(12, 4,    'Grace Wanjiku',   'grace.wanjiku@example.com',     'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(13, 6,    'Mary Akinyi',     'mary.akinyi@example.com',       'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(14, 7,    'Kevin Ochieng',   'kevin.ochieng@example.com',     'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(15, 9,    'Joseph Mutua',    'joseph.mutua@example.com',      'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(16, 10,   'Naliaka Wekesa',  'naliaka.wekesa@example.com',    'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
(17, 12,   'Wanjiru Kariuki', 'wanjiru.kariuki@example.com',   'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'CUSTOMER',     1),
-- Staff (customer_id is NULL)
(4,  NULL, 'Sarah Njeri',     'sarah.njeri@garage.local',      'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'ADMIN',        1),
(5,  NULL, 'John Kipchoge',   'john.kipchoge@garage.local',    'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'RECEPTIONIST', 1),
(6,  NULL, 'David Maina',     'david.maina@garage.local',      'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'MECHANIC',     1),
(7,  NULL, 'Michael Ouma',    'michael.ouma@garage.local',     'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'MECHANIC',     1),
(8,  NULL, 'Esther Achieng',  'esther.achieng@garage.local',   'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'ADMIN',        1),
(9,  NULL, 'Faith Muthoni',   'faith.muthoni@garage.local',    'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'RECEPTIONIST', 1),
(10, NULL, 'Brian Kiprotich', 'brian.kiprotich@garage.local',  'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'MECHANIC',     1),
(11, NULL, 'Samuel Njoroge',  'samuel.njoroge@garage.local',   'scrypt$32768$8$1$9dfb4cb9d55f3fa583d7766efb182212$fc5a893c1fe0c6bc105763989ef45cb1260f44e9f3970f15aa42cf863368eda7c25769e5f12619499bf113c7f4090e74fa4c9db36b3ace4e8ee170f9639e7aff', 'MECHANIC',     0);

-- ============================================================================
-- VEHICLES
-- James (1) and Joseph (9) have three vehicles; Aisha (2) and Mary (6) have two.
-- ============================================================================
INSERT INTO vehicle (vehicle_id, customer_id, registration_no, make, model, year, mileage) VALUES
(1,  1,  'KCA 123A', 'Toyota',        'Corolla',      2018, 86400),
(2,  1,  'KCB 456B', 'Nissan',        'Note',         2020, 43100),
(3,  2,  'KCC 789C', 'Subaru',        'Forester',     2017, 112300),
(4,  3,  'KCD 012D', 'Honda',         'Fit',          2019, 63900),
(5,  4,  'KCE 345E', 'Toyota',        'Land Cruiser', 2015, 181200),
(6,  5,  'KCF 678F', 'Mazda',         'Demio',        2021, 28700),
(7,  1,  'KDA 789J', 'Toyota',        'Probox',       2016, 154000),
(8,  2,  'KDB 234K', 'Mazda',         'CX-5',         2019, 58200),
(9,  6,  'KDC 567L', 'Toyota',        'Vitz',         2014, 132500),
(10, 6,  'KDD 890M', 'Mitsubishi',    'Outlander',    2018, 97800),
(11, 7,  'KDE 123N', 'Volkswagen',    'Golf',         2016, 104600),
(12, 8,  'KCG 456P', 'Toyota',        'Axio',         2015, 141000),
(13, 9,  'KBZ 789Q', 'Isuzu',         'D-Max',        2013, 238500),
(14, 9,  'KCH 012R', 'Toyota',        'HiAce',        2017, 196300),
(15, 9,  'KDF 345S', 'Toyota',        'Hilux',        2021, 71400),
(16, 10, 'KDG 678T', 'Suzuki',        'Swift',        2020, 39800),
(17, 11, 'KCJ 901U', 'Mercedes-Benz', 'C200',         2014, 128900),
(18, 12, 'KDH 234V', 'Honda',         'CR-V',         2022, 18600);

-- ============================================================================
-- SERVICE TASKS (reusable templates / service catalogue)
-- "Pre-Purchase Inspection" has no standard hours yet: an admin still needs to set them.
-- ============================================================================
INSERT INTO service_task (service_task_id, name, standard_hours) VALUES
(1,  'Oil Change',                      0.50),
(2,  'Brake Pad Replacement (Front)',   1.50),
(3,  'Brake Pad Replacement (Rear)',    1.50),
(4,  'Full Diagnostic Scan',            1.00),
(5,  'Tyre Rotation',                   0.75),
(6,  'Tyre Replacement (per tyre)',     0.50),
(7,  'Battery Replacement',             0.25),
(8,  'Air Filter Replacement',          0.25),
(9,  'Wheel Alignment',                 1.00),
(10, 'Coolant Flush',                   1.00),
(11, 'Spark Plug Replacement',          1.50),
(12, 'Suspension Check',                1.00),
(13, 'AC Service & Regas',              2.00),
(14, 'Transmission Fluid Change',       1.50),
(15, 'Full Vehicle Service',            3.00),
(16, 'Clutch Replacement',              4.00),
(17, 'Brake Fluid Flush',               0.75),
(18, 'Timing Belt Replacement',         3.50),
(19, 'Pre-Purchase Inspection',         NULL);

-- ============================================================================
-- PARTS (catalogue with current prices in KES)
-- Engine oil was 3,300.00 until about 60 days ago; older job parts and invoices keep that snapshot price.
-- "Clutch Kit" has no price yet, so it cannot be recorded on a job until an admin sets one (job card 16 is waiting on it).
-- ============================================================================
INSERT INTO part (part_id, name, unit_price) VALUES
(1,  'Engine Oil 5W-30 (4L)',         3500.00),
(2,  'Oil Filter',                    800.00),
(3,  'Air Filter',                    1200.00),
(4,  'Front Brake Pads (set)',        4500.00),
(5,  'Rear Brake Pads (set)',         3800.00),
(6,  'Brake Disc (front)',            6500.00),
(7,  'Battery 12V 60Ah',              12000.00),
(8,  'Spark Plug (each)',             650.00),
(9,  'Coolant 1L',                    800.00),
(10, 'Transmission Fluid 1L',         1500.00),
(11, 'Windshield Wiper (pair)',       1800.00),
(12, 'Cabin Air Filter',              1500.00),
(13, 'Fuel Filter',                   2200.00),
(14, 'Drive Belt',                    3500.00),
(15, 'Tyre 195/65R15 (each)',         8500.00),
(16, 'Shock Absorber (front, each)',  7500.00),
(17, 'Wheel Bearing',                 4200.00),
(18, 'AC Refrigerant R134a (can)',    2500.00),
(19, 'Brake Fluid DOT4 1L',           1100.00),
(20, 'Timing Belt Kit',               14500.00),
(21, 'Clutch Kit',                    NULL);

-- ============================================================================
-- BOOKINGS (appointments)
-- Active bookings (PENDING / CONFIRMED / CHECKED_IN) never overlap on the same bay or vehicle,
-- and all fall inside opening hours (08:00-17:00 Nairobi, Monday-Saturday).
-- version counts status changes: PENDING 1, CONFIRMED 2, CHECKED_IN 3, COMPLETED 4.
-- ============================================================================
INSERT INTO booking (booking_id, vehicle_id, bay_id, scheduled_at, ends_at, status, version) VALUES
-- Past appointments that became job cards
(1,  1,  1, @ago_120 + INTERVAL '08:00' HOUR_MINUTE, @ago_120 + INTERVAL '11:00' HOUR_MINUTE, 'COMPLETED',  4), -- KCA 123A James: full service
(2,  3,  2, @ago_81 + INTERVAL '09:00' HOUR_MINUTE,  @ago_81 + INTERVAL '11:00' HOUR_MINUTE,  'COMPLETED',  4), -- KCC 789C Aisha: suspension
(3,  11, 3, @ago_53 + INTERVAL '10:00' HOUR_MINUTE,  @ago_53 + INTERVAL '12:30' HOUR_MINUTE,  'COMPLETED',  4), -- KDE 123N Kevin: misfire diagnosis
(4,  9,  4, @ago_46 + INTERVAL '08:00' HOUR_MINUTE,  @ago_46 + INTERVAL '10:00' HOUR_MINUTE,  'COMPLETED',  4), -- KDC 567L Mary: oil + tyres
(5,  2,  2, @ago_39 + INTERVAL '13:00' HOUR_MINUTE,  @ago_39 + INTERVAL '15:30' HOUR_MINUTE,  'COMPLETED',  4), -- KCB 456B James: AC service
(6,  4,  1, @ago_25 + INTERVAL '11:00' HOUR_MINUTE,  @ago_25 + INTERVAL '12:00' HOUR_MINUTE,  'COMPLETED',  4), -- KCD 012D Peter: battery
(7,  16, 4, @ago_18 + INTERVAL '09:00' HOUR_MINUTE,  @ago_18 + INTERVAL '10:30' HOUR_MINUTE,  'COMPLETED',  4), -- KDG 678T Naliaka: oil + rotation
(8,  10, 1, @ago_10 + INTERVAL '08:00' HOUR_MINUTE,  @ago_10 + INTERVAL '11:00' HOUR_MINUTE,  'COMPLETED',  4), -- KDD 890M Mary: front brakes
(9,  8,  4, @ago_7 + INTERVAL '14:00' HOUR_MINUTE,   @ago_7 + INTERVAL '16:00' HOUR_MINUTE,   'COMPLETED',  4), -- KDB 234K Aisha: alignment
-- Past appointments that did not go ahead
(10, 11, 2, @ago_10 + INTERVAL '14:00' HOUR_MINUTE,  @ago_10 + INTERVAL '15:00' HOUR_MINUTE,  'NO_SHOW',    3), -- KDE 123N Kevin: customer did not arrive
(11, 16, 3, @ago_5 + INTERVAL '09:00' HOUR_MINUTE,   @ago_5 + INTERVAL '10:00' HOUR_MINUTE,   'CANCELLED',  2), -- KDG 678T Naliaka: cancelled by customer
-- Today
(12, 1,  1, @day_0 + INTERVAL '08:00' HOUR_MINUTE,   @day_0 + INTERVAL '10:00' HOUR_MINUTE,   'CHECKED_IN', 3), -- KCA 123A James: job in progress
(13, 13, 3, @day_0 + INTERVAL '09:00' HOUR_MINUTE,   @day_0 + INTERVAL '12:00' HOUR_MINUTE,   'CHECKED_IN', 3), -- KBZ 789Q Joseph: job opened, not started
(14, 4,  2, @day_0 + INTERVAL '13:00' HOUR_MINUTE,   @day_0 + INTERVAL '14:00' HOUR_MINUTE,   'CONFIRMED',  2), -- KCD 012D Peter: later today
-- Upcoming
(15, 2,  1, @in_2 + INTERVAL '08:00' HOUR_MINUTE,    @in_2 + INTERVAL '09:00' HOUR_MINUTE,    'CONFIRMED',  2), -- KCB 456B James: oil change
(16, 3,  2, @in_2 + INTERVAL '10:00' HOUR_MINUTE,    @in_2 + INTERVAL '12:00' HOUR_MINUTE,    'PENDING',    1), -- KCC 789C Aisha: brake check
(17, 18, 3, @in_4 + INTERVAL '09:00' HOUR_MINUTE,    @in_4 + INTERVAL '10:00' HOUR_MINUTE,    'PENDING',    1), -- KDH 234V Wanjiru: first visit
(18, 9,  1, @in_4 + INTERVAL '14:00' HOUR_MINUTE,    @in_4 + INTERVAL '15:30' HOUR_MINUTE,    'CONFIRMED',  2), -- KDC 567L Mary: AC service
(19, 7,  1, @in_6 + INTERVAL '11:00' HOUR_MINUTE,    @in_6 + INTERVAL '14:00' HOUR_MINUTE,    'PENDING',    1), -- KDA 789J James: full service
(20, 14, 2, @in_6 + INTERVAL '08:00' HOUR_MINUTE,    @in_6 + INTERVAL '11:00' HOUR_MINUTE,    'CONFIRMED',  2), -- KCH 012R Joseph: fleet service
(21, 5,  1, @in_9 + INTERVAL '08:00' HOUR_MINUTE,    @in_9 + INTERVAL '10:00' HOUR_MINUTE,    'CONFIRMED',  2), -- KCE 345E Grace: transmission fluid
(22, 11, 1, @in_9 + INTERVAL '13:00' HOUR_MINUTE,    @in_9 + INTERVAL '14:00' HOUR_MINUTE,    'PENDING',    1), -- KDE 123N Kevin: rebooked after no-show
(23, 16, 4, @in_13 + INTERVAL '10:00' HOUR_MINUTE,   @in_13 + INTERVAL '11:00' HOUR_MINUTE,   'PENDING',    1), -- KDG 678T Naliaka: tyre rotation
(24, 12, 1, @in_20 + INTERVAL '09:00' HOUR_MINUTE,   @in_20 + INTERVAL '10:00' HOUR_MINUTE,   'PENDING',    1); -- KCG 456P Lucy: booked by reception

-- ============================================================================
-- JOB CARDS
-- A vehicle has at most one job that is not CLOSED or CANCELLED (the server enforces this).
-- CLOSED = invoice fully paid. COMPLETED = invoiced, balance outstanding.
-- Mechanic 11 (Samuel) is deactivated; he only appears on older, closed jobs.
-- ============================================================================
INSERT INTO job_card (job_card_id, vehicle_id, booking_id, mechanic_id, opened_at, status, version) VALUES
(1,  1,  1,    11, @ago_120 + INTERVAL '08:10' HOUR_MINUTE, 'CLOSED',         9), -- KCA 123A
(2,  5,  NULL, 6,  @ago_95 + INTERVAL '09:30' HOUR_MINUTE,  'CLOSED',         11), -- KCE 345E
(3,  3,  2,    7,  @ago_81 + INTERVAL '09:15' HOUR_MINUTE,  'CLOSED',         7), -- KCC 789C
(4,  13, NULL, 11, @ago_67 + INTERVAL '08:30' HOUR_MINUTE,  'CLOSED',         8), -- KBZ 789Q
(5,  11, 3,    6,  @ago_53 + INTERVAL '10:05' HOUR_MINUTE,  'CLOSED',         7), -- KDE 123N
(6,  9,  4,    7,  @ago_46 + INTERVAL '08:05' HOUR_MINUTE,  'CLOSED',         9), -- KDC 567L
(7,  2,  5,    10, @ago_39 + INTERVAL '13:10' HOUR_MINUTE,  'CLOSED',         8), -- KCB 456B
(8,  14, NULL, 6,  @ago_32 + INTERVAL '08:00' HOUR_MINUTE,  'CLOSED',         10), -- KCH 012R
(9,  4,  6,    7,  @ago_25 + INTERVAL '11:05' HOUR_MINUTE,  'CLOSED',         7), -- KCD 012D
(10, 16, 7,    10, @ago_18 + INTERVAL '09:05' HOUR_MINUTE,  'CLOSED',         8), -- KDG 678T
(11, 17, NULL, 6,  @ago_14 + INTERVAL '10:00' HOUR_MINUTE,  'CLOSED',         8), -- KCJ 901U
(12, 10, 8,    7,  @ago_10 + INTERVAL '08:10' HOUR_MINUTE,  'COMPLETED',      7), -- KDD 890M
(13, 8,  9,    6,  @ago_7 + INTERVAL '14:05' HOUR_MINUTE,   'COMPLETED',      5), -- KDB 234K
(14, 15, NULL, 10, @ago_5 + INTERVAL '08:00' HOUR_MINUTE,   'COMPLETED',      8), -- KDF 345S
(15, 12, NULL, 7,  @ago_3 + INTERVAL '10:30' HOUR_MINUTE,   'CANCELLED',      2), -- KCG 456P
(16, 6,  NULL, 6,  @ago_3 + INTERVAL '08:30' HOUR_MINUTE,   'AWAITING_PARTS', 4), -- KCF 678F
(17, 1,  12,   7,  @day_0 + INTERVAL '08:05' HOUR_MINUTE,   'IN_PROGRESS',    7), -- KCA 123A
(18, 13, 13,   10, @day_0 + INTERVAL '09:10' HOUR_MINUTE,   'OPEN',           1); -- KBZ 789Q

-- ============================================================================
-- TASKS (performed on job cards)
-- ============================================================================
INSERT INTO task (task_id, job_card_id, name, standard_hours) VALUES
(1,  1,  'Full Vehicle Service',                3.00),
(2,  2,  'Oil Change',                          0.50),
(3,  2,  'Air Filter Replacement',              0.25),
(4,  2,  'Brake Pad Replacement (Front)',       1.50),
(5,  3,  'Suspension Check',                    1.00),
(6,  3,  'Front Shock Absorber Replacement',    2.00),
(7,  4,  'Brake Pad Replacement (Rear)',        1.50),
(8,  4,  'Brake Fluid Flush',                   0.75),
(9,  5,  'Full Diagnostic Scan',                1.00),
(10, 5,  'Spark Plug Replacement',              1.50),
(11, 6,  'Oil Change',                          0.50),
(12, 6,  'Tyre Replacement (2 tyres)',          1.00),
(13, 7,  'AC Service & Regas',                  2.00),
(14, 7,  'Cabin Air Filter Replacement',        0.25),
(15, 8,  'Full Vehicle Service',                3.00),
(16, 8,  'Wheel Alignment',                     1.00),
(17, 9,  'Battery Replacement',                 0.25),
(18, 10, 'Oil Change',                          0.50),
(19, 10, 'Tyre Rotation',                       0.75),
(20, 11, 'Coolant Flush',                       1.00),
(21, 11, 'Drive Belt Replacement',              1.00),
(22, 12, 'Brake Pad Replacement (Front)',       1.50),
(23, 12, 'Front Brake Disc Replacement',        1.00),
(24, 13, 'Wheel Alignment',                     1.00),
(25, 13, 'Tyre Rotation',                       0.75),
(26, 14, 'Full Vehicle Service',                3.00),
(27, 16, 'Clutch Replacement',                  4.00),
(28, 17, 'Oil Change',                          0.50),
(29, 17, 'Brake Pad Replacement (Front)',       1.50);

-- ============================================================================
-- JOB PARTS (parts consumed, with price snapshot)
-- ============================================================================
INSERT INTO job_part (job_card_id, part_id, quantity, unit_price_snapshot) VALUES
(1,  1,  1, 3300.00 ), -- Engine Oil 5W-30 (4L)
(1,  2,  1, 800.00  ), -- Oil Filter
(1,  3,  1, 1200.00 ), -- Air Filter
(1,  8,  4, 650.00  ), -- Spark Plug (each)
(2,  1,  1, 3300.00 ), -- Engine Oil 5W-30 (4L)
(2,  2,  1, 800.00  ), -- Oil Filter
(2,  3,  1, 1200.00 ), -- Air Filter
(2,  4,  1, 4500.00 ), -- Front Brake Pads (set)
(3,  16, 2, 7500.00 ), -- Shock Absorber (front, each)
(4,  5,  1, 3800.00 ), -- Rear Brake Pads (set)
(4,  19, 2, 1100.00 ), -- Brake Fluid DOT4 1L
(5,  8,  4, 650.00  ), -- Spark Plug (each)
(6,  1,  1, 3500.00 ), -- Engine Oil 5W-30 (4L)
(6,  2,  1, 800.00  ), -- Oil Filter
(6,  15, 2, 8500.00 ), -- Tyre 195/65R15 (each)
(7,  18, 2, 2500.00 ), -- AC Refrigerant R134a (can)
(7,  12, 1, 1500.00 ), -- Cabin Air Filter
(8,  1,  2, 3500.00 ), -- Engine Oil 5W-30 (4L)
(8,  2,  1, 800.00  ), -- Oil Filter
(8,  13, 1, 2200.00 ), -- Fuel Filter
(8,  3,  1, 1200.00 ), -- Air Filter
(9,  7,  1, 12000.00), -- Battery 12V 60Ah
(9,  11, 1, 1800.00 ), -- Windshield Wiper (pair)
(10, 1,  1, 3500.00 ), -- Engine Oil 5W-30 (4L)
(10, 2,  1, 800.00  ), -- Oil Filter
(11, 9,  4, 800.00  ), -- Coolant 1L
(11, 14, 1, 3500.00 ), -- Drive Belt
(12, 4,  1, 4500.00 ), -- Front Brake Pads (set)
(12, 6,  2, 6500.00 ), -- Brake Disc (front)
(14, 1,  2, 3500.00 ), -- Engine Oil 5W-30 (4L)
(14, 2,  1, 800.00  ), -- Oil Filter
(14, 13, 1, 2200.00 ), -- Fuel Filter
(14, 3,  1, 1200.00 ), -- Air Filter
(17, 1,  1, 3500.00 ), -- Engine Oil 5W-30 (4L)
(17, 2,  1, 800.00  ), -- Oil Filter
(17, 4,  1, 4500.00 ); -- Front Brake Pads (set)

-- ============================================================================
-- INVOICES (one per completed job card)
-- ============================================================================
INSERT INTO invoice (invoice_id, job_card_id, total_amount, currency, issued_at) VALUES
(1,  1,  10900.00, 'KES', @ago_120 + INTERVAL '11:30' HOUR_MINUTE), -- labour 3,000.00 + parts 7,900.00; paid
(2,  2,  12050.00, 'KES', @ago_95 + INTERVAL '14:00' HOUR_MINUTE), -- labour 2,250.00 + parts 9,800.00; paid
(3,  3,  18000.00, 'KES', @ago_81 + INTERVAL '12:30' HOUR_MINUTE), -- labour 3,000.00 + parts 15,000.00; paid
(4,  4,  8250.00,  'KES', @ago_67 + INTERVAL '11:30' HOUR_MINUTE), -- labour 2,250.00 + parts 6,000.00; paid
(5,  5,  5100.00,  'KES', @ago_53 + INTERVAL '13:00' HOUR_MINUTE), -- labour 2,500.00 + parts 2,600.00; paid
(6,  6,  22800.00, 'KES', @ago_46 + INTERVAL '10:30' HOUR_MINUTE), -- labour 1,500.00 + parts 21,300.00; paid
(7,  7,  8750.00,  'KES', @ago_39 + INTERVAL '15:45' HOUR_MINUTE), -- labour 2,250.00 + parts 6,500.00; paid
(8,  8,  15200.00, 'KES', @ago_32 + INTERVAL '13:30' HOUR_MINUTE), -- labour 4,000.00 + parts 11,200.00; paid
(9,  9,  14050.00, 'KES', @ago_25 + INTERVAL '11:50' HOUR_MINUTE), -- labour 250.00 + parts 13,800.00; paid
(10, 10, 5550.00,  'KES', @ago_18 + INTERVAL '10:40' HOUR_MINUTE), -- labour 1,250.00 + parts 4,300.00; paid
(11, 11, 8700.00,  'KES', @ago_14 + INTERVAL '13:00' HOUR_MINUTE), -- labour 2,000.00 + parts 6,700.00; paid
(12, 12, 20000.00, 'KES', @ago_10 + INTERVAL '11:30' HOUR_MINUTE), -- labour 2,500.00 + parts 17,500.00; partly paid, 8,000.00 due
(13, 13, 1750.00,  'KES', @ago_7 + INTERVAL '16:15' HOUR_MINUTE), -- labour 1,750.00 + parts 0.00; unpaid
(14, 14, 14200.00, 'KES', @ago_5 + INTERVAL '12:00' HOUR_MINUTE); -- labour 3,000.00 + parts 11,200.00; unpaid

-- ============================================================================
-- INVOICE LINES (immutable snapshot of invoice items)
-- ============================================================================
INSERT INTO invoice_line (invoice_line_id, invoice_id, kind, description, quantity, unit_price, line_total) VALUES
(1,  1,  'LABOR', 'Full Vehicle Service',                3.00, 1000.00,  3000.00),
(2,  1,  'PART',  'Engine Oil 5W-30 (4L)',               1.00, 3300.00,  3300.00),
(3,  1,  'PART',  'Oil Filter',                          1.00, 800.00,   800.00),
(4,  1,  'PART',  'Air Filter',                          1.00, 1200.00,  1200.00),
(5,  1,  'PART',  'Spark Plug (each)',                   4.00, 650.00,   2600.00),
(6,  2,  'LABOR', 'Oil Change',                          0.50, 1000.00,  500.00),
(7,  2,  'LABOR', 'Air Filter Replacement',              0.25, 1000.00,  250.00),
(8,  2,  'LABOR', 'Brake Pad Replacement (Front)',       1.50, 1000.00,  1500.00),
(9,  2,  'PART',  'Engine Oil 5W-30 (4L)',               1.00, 3300.00,  3300.00),
(10, 2,  'PART',  'Oil Filter',                          1.00, 800.00,   800.00),
(11, 2,  'PART',  'Air Filter',                          1.00, 1200.00,  1200.00),
(12, 2,  'PART',  'Front Brake Pads (set)',              1.00, 4500.00,  4500.00),
(13, 3,  'LABOR', 'Suspension Check',                    1.00, 1000.00,  1000.00),
(14, 3,  'LABOR', 'Front Shock Absorber Replacement',    2.00, 1000.00,  2000.00),
(15, 3,  'PART',  'Shock Absorber (front, each)',        2.00, 7500.00,  15000.00),
(16, 4,  'LABOR', 'Brake Pad Replacement (Rear)',        1.50, 1000.00,  1500.00),
(17, 4,  'LABOR', 'Brake Fluid Flush',                   0.75, 1000.00,  750.00),
(18, 4,  'PART',  'Rear Brake Pads (set)',               1.00, 3800.00,  3800.00),
(19, 4,  'PART',  'Brake Fluid DOT4 1L',                 2.00, 1100.00,  2200.00),
(20, 5,  'LABOR', 'Full Diagnostic Scan',                1.00, 1000.00,  1000.00),
(21, 5,  'LABOR', 'Spark Plug Replacement',              1.50, 1000.00,  1500.00),
(22, 5,  'PART',  'Spark Plug (each)',                   4.00, 650.00,   2600.00),
(23, 6,  'LABOR', 'Oil Change',                          0.50, 1000.00,  500.00),
(24, 6,  'LABOR', 'Tyre Replacement (2 tyres)',          1.00, 1000.00,  1000.00),
(25, 6,  'PART',  'Engine Oil 5W-30 (4L)',               1.00, 3500.00,  3500.00),
(26, 6,  'PART',  'Oil Filter',                          1.00, 800.00,   800.00),
(27, 6,  'PART',  'Tyre 195/65R15 (each)',               2.00, 8500.00,  17000.00),
(28, 7,  'LABOR', 'AC Service & Regas',                  2.00, 1000.00,  2000.00),
(29, 7,  'LABOR', 'Cabin Air Filter Replacement',        0.25, 1000.00,  250.00),
(30, 7,  'PART',  'AC Refrigerant R134a (can)',          2.00, 2500.00,  5000.00),
(31, 7,  'PART',  'Cabin Air Filter',                    1.00, 1500.00,  1500.00),
(32, 8,  'LABOR', 'Full Vehicle Service',                3.00, 1000.00,  3000.00),
(33, 8,  'LABOR', 'Wheel Alignment',                     1.00, 1000.00,  1000.00),
(34, 8,  'PART',  'Engine Oil 5W-30 (4L)',               2.00, 3500.00,  7000.00),
(35, 8,  'PART',  'Oil Filter',                          1.00, 800.00,   800.00),
(36, 8,  'PART',  'Fuel Filter',                         1.00, 2200.00,  2200.00),
(37, 8,  'PART',  'Air Filter',                          1.00, 1200.00,  1200.00),
(38, 9,  'LABOR', 'Battery Replacement',                 0.25, 1000.00,  250.00),
(39, 9,  'PART',  'Battery 12V 60Ah',                    1.00, 12000.00, 12000.00),
(40, 9,  'PART',  'Windshield Wiper (pair)',             1.00, 1800.00,  1800.00),
(41, 10, 'LABOR', 'Oil Change',                          0.50, 1000.00,  500.00),
(42, 10, 'LABOR', 'Tyre Rotation',                       0.75, 1000.00,  750.00),
(43, 10, 'PART',  'Engine Oil 5W-30 (4L)',               1.00, 3500.00,  3500.00),
(44, 10, 'PART',  'Oil Filter',                          1.00, 800.00,   800.00),
(45, 11, 'LABOR', 'Coolant Flush',                       1.00, 1000.00,  1000.00),
(46, 11, 'LABOR', 'Drive Belt Replacement',              1.00, 1000.00,  1000.00),
(47, 11, 'PART',  'Coolant 1L',                          4.00, 800.00,   3200.00),
(48, 11, 'PART',  'Drive Belt',                          1.00, 3500.00,  3500.00),
(49, 12, 'LABOR', 'Brake Pad Replacement (Front)',       1.50, 1000.00,  1500.00),
(50, 12, 'LABOR', 'Front Brake Disc Replacement',        1.00, 1000.00,  1000.00),
(51, 12, 'PART',  'Front Brake Pads (set)',              1.00, 4500.00,  4500.00),
(52, 12, 'PART',  'Brake Disc (front)',                  2.00, 6500.00,  13000.00),
(53, 13, 'LABOR', 'Wheel Alignment',                     1.00, 1000.00,  1000.00),
(54, 13, 'LABOR', 'Tyre Rotation',                       0.75, 1000.00,  750.00),
(55, 14, 'LABOR', 'Full Vehicle Service',                3.00, 1000.00,  3000.00),
(56, 14, 'PART',  'Engine Oil 5W-30 (4L)',               2.00, 3500.00,  7000.00),
(57, 14, 'PART',  'Oil Filter',                          1.00, 800.00,   800.00),
(58, 14, 'PART',  'Fuel Filter',                         1.00, 2200.00,  2200.00),
(59, 14, 'PART',  'Air Filter',                          1.00, 1200.00,  1200.00);

-- ============================================================================
-- PAYMENTS
-- Non-cash payments carry a unique transaction reference; cash payments have none.
-- ============================================================================
INSERT INTO payment (payment_id, invoice_id, amount, paid_at, method, transaction_reference) VALUES
(1,  1,  10900.00, @ago_120 + INTERVAL '11:45' HOUR_MINUTE, 'MOBILE_MONEY',  'RKT8M2QX4B'),
(2,  2,  8000.00,  @ago_95 + INTERVAL '14:15' HOUR_MINUTE,  'MOBILE_MONEY',  'RLC3H7VN9D'),
(3,  2,  4050.00,  @ago_95 + INTERVAL '14:30' HOUR_MINUTE,  'CASH',          NULL),
(4,  3,  18000.00, @ago_81 + INTERVAL '12:40' HOUR_MINUTE,  'CARD',          'CARD-AUTH-482913'),
(5,  4,  8250.00,  @ago_53 + INTERVAL '10:00' HOUR_MINUTE,  'BANK_TRANSFER', 'EQB-TRF-77310452'),
(6,  5,  5100.00,  @ago_53 + INTERVAL '13:10' HOUR_MINUTE,  'CASH',          NULL),
(7,  6,  10000.00, @ago_46 + INTERVAL '10:45' HOUR_MINUTE,  'MOBILE_MONEY',  'RNF6K1TP3S'),
(8,  6,  12800.00, @ago_39 + INTERVAL '09:20' HOUR_MINUTE,  'MOBILE_MONEY',  'RPA2W8LM5C'),
(9,  7,  8750.00,  @ago_39 + INTERVAL '16:00' HOUR_MINUTE,  'CARD',          'CARD-AUTH-519026'),
(10, 8,  15200.00, @ago_25 + INTERVAL '10:00' HOUR_MINUTE,  'BANK_TRANSFER', 'EQB-TRF-77455108'),
(11, 9,  14050.00, @ago_25 + INTERVAL '12:00' HOUR_MINUTE,  'MOBILE_MONEY',  'RQD9B4ZK7E'),
(12, 10, 5550.00,  @ago_18 + INTERVAL '10:50' HOUR_MINUTE,  'MOBILE_MONEY',  'RRH5C3XJ8F'),
(13, 11, 8700.00,  @ago_14 + INTERVAL '13:15' HOUR_MINUTE,  'CASH',          NULL),
(14, 12, 12000.00, @ago_10 + INTERVAL '11:45' HOUR_MINUTE,  'MOBILE_MONEY',  'RSJ7D6YN2G');

-- ============================================================================
-- AUDIT EVENTS (sample entries)
-- action = API operationId and resource_type = OpenAPI tag, matching what the server writes.
-- ============================================================================
INSERT INTO audit_event (audit_id, actor_user_id, action, resource_type, resource_id, occurred_at, request_id, outcome) VALUES
(1,  4,    'createStaffUser',     'Users',         NULL, @ago_150 + INTERVAL '09:00' HOUR_MINUTE, 'seed-0001', 'SUCCESS'),
(2,  4,    'createStaffUser',     'Users',         NULL, @ago_150 + INTERVAL '09:05' HOUR_MINUTE, 'seed-0002', 'SUCCESS'),
(3,  4,    'createStaffUser',     'Users',         NULL, @ago_150 + INTERVAL '09:10' HOUR_MINUTE, 'seed-0003', 'SUCCESS'),
(4,  5,    'login',               'Authentication', NULL, @ago_120 + INTERVAL '07:55' HOUR_MINUTE, 'seed-0004', 'SUCCESS'),
(5,  5,    'createJobCard',       'Job cards',     NULL, @ago_120 + INTERVAL '08:10' HOUR_MINUTE, 'seed-0005', 'SUCCESS'),
(6,  5,    'createCustomer',      'Customers',     NULL, @ago_95 + INTERVAL '09:25' HOUR_MINUTE,  'seed-0006', 'SUCCESS'),
(7,  4,    'updatePart',          'Parts',         '1',  @ago_60 + INTERVAL '10:00' HOUR_MINUTE,  'seed-0007', 'SUCCESS'),
(8,  9,    'recordPayment',       'Payments',      '4',  @ago_53 + INTERVAL '10:00' HOUR_MINUTE,  'seed-0008', 'SUCCESS'),
(9,  8,    'updateStaffUser',     'Users',         '11', @ago_22 + INTERVAL '16:30' HOUR_MINUTE,  'seed-0009', 'SUCCESS'),
(10, NULL, 'login',               'Authentication', NULL, @ago_20 + INTERVAL '07:40' HOUR_MINUTE,  'seed-0010', 'FAILURE'),
(11, 4,    'createServiceTask',   'Service tasks', NULL, @ago_16 + INTERVAL '11:00' HOUR_MINUTE,  'seed-0011', 'SUCCESS'),
(12, 9,    'createCustomer',      'Customers',     NULL, @ago_14 + INTERVAL '09:55' HOUR_MINUTE,  'seed-0012', 'SUCCESS'),
(13, 9,    'recordPayment',       'Payments',      '11', @ago_14 + INTERVAL '13:15' HOUR_MINUTE,  'seed-0013', 'SUCCESS'),
(14, 5,    'createJobCard',       'Job cards',     NULL, @ago_10 + INTERVAL '08:10' HOUR_MINUTE,  'seed-0014', 'SUCCESS'),
(15, 5,    'createInvoice',       'Invoices',      NULL, @ago_10 + INTERVAL '11:30' HOUR_MINUTE,  'seed-0015', 'SUCCESS'),
(16, 5,    'recordPayment',       'Payments',      '12', @ago_10 + INTERVAL '11:45' HOUR_MINUTE,  'seed-0016', 'SUCCESS'),
(17, 5,    'updateBookingStatus', 'Bookings',      '10', @ago_10 + INTERVAL '15:30' HOUR_MINUTE,  'seed-0017', 'SUCCESS'),
(18, 1,    'listCustomers',       'Customers',     NULL, @ago_7 + INTERVAL '18:20' HOUR_MINUTE,   'seed-0018', 'DENIED'),
(19, 16,   'updateBookingStatus', 'Bookings',      '11', @ago_5 + INTERVAL '06:30' HOUR_MINUTE,   'seed-0019', 'SUCCESS'),
(20, 9,    'createInvoice',       'Invoices',      NULL, @ago_5 + INTERVAL '12:00' HOUR_MINUTE,   'seed-0020', 'SUCCESS'),
(21, 6,    'updateJobCardStatus', 'Job cards',     '16', @ago_3 + INTERVAL '11:00' HOUR_MINUTE,   'seed-0021', 'SUCCESS'),
(22, 9,    'updateJobCardStatus', 'Job cards',     '15', @ago_3 + INTERVAL '11:15' HOUR_MINUTE,   'seed-0022', 'SUCCESS'),
(23, 8,    'login',               'Authentication', NULL, @day_0 + INTERVAL '07:50' HOUR_MINUTE,   'seed-0023', 'SUCCESS'),
(24, 5,    'createJobCard',       'Job cards',     NULL, @day_0 + INTERVAL '08:05' HOUR_MINUTE,   'seed-0024', 'SUCCESS'),
(25, 7,    'updateJobCardStatus', 'Job cards',     '17', @day_0 + INTERVAL '08:20' HOUR_MINUTE,   'seed-0025', 'SUCCESS'),
(26, 5,    'createJobCard',       'Job cards',     NULL, @day_0 + INTERVAL '09:10' HOUR_MINUTE,   'seed-0026', 'SUCCESS');

SET FOREIGN_KEY_CHECKS = 1;
