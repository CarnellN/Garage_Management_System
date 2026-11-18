-- ============================================================================
-- Migration 001 — two-factor authentication and password reset
-- Applies to databases created from an earlier schema.sql (16 tables).
-- Safe to re-run: every statement uses IF NOT EXISTS.
--   mysql -u <admin user> -p garage_management_db < migrations/001_mfa_password_reset.sql
-- ============================================================================

SET NAMES utf8mb4;

