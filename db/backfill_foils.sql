-- Backfill missing `foil` values in dwlist based on rider recollection
-- and cross-referencing against confirmed foil usage nearby in time,
-- per-region introduction dates for the KT Atlas 790, and paddle-up
-- telemetry (distance_to_first_paddle_up) for one specific outlier run.
--
-- confidence values:
--   high   - tightly bounded by confirmed foil use on both sides, or a
--            specific rider memory matching the telemetry
--   medium - bounded by confirmed use, but a nearby exception exists
--   low    - best guess from wind speed / regional pattern, no direct
--            confirmation nearby

begin;

call lake.set_commit_message('dustin', 'backfilling unknown foils');

alter table dwlist add column if not exists foil_confidence varchar;

-- 2024-07-01 | Kihei | Green Church -> Kalepolepo
-- Before any confirmed foil use in the log; HS1550 was the first foil owned
update dwlist set foil = 'Armstrong HS1550', foil_confidence = 'high' where id = '019965b7-97de-7afe-9ccf-99bdb3dccf40';

-- 2024-07-01 | Kihei | Green Church -> Kalepolepo
-- Before any confirmed foil use in the log; HS1550 was the first foil owned
update dwlist set foil = 'Armstrong HS1550', foil_confidence = 'high' where id = '019965b7-97de-70d7-8414-ec0a6b9c6220';

-- 2024-09-21 | Kihei | Sugar Beach -> Kalepolepo
-- Could be HS1550 or HA1325 (both owned at this time, no way to distinguish); HA1325 chosen
-- arbitrarily per rider
update dwlist set foil = 'Armstrong HA1325', foil_confidence = 'medium' where id = '019965b7-97de-741e-b288-60f05a006282';

-- 2024-09-21 | Kihei | Sugar Beach -> Kalepolepo
-- Could be HS1550 or HA1325 (both owned at this time, no way to distinguish); HA1325 chosen
-- arbitrarily per rider
update dwlist set foil = 'Armstrong HA1325', foil_confidence = 'medium' where id = '019965b7-97de-7b0f-a75d-ba770f967944';

-- 2024-09-26 | Kihei | Green Church -> Kalepolepo
-- Could be HS1550 or HA1325 (both owned at this time, no way to distinguish); HA1325 chosen
-- arbitrarily per rider
update dwlist set foil = 'Armstrong HA1325', foil_confidence = 'medium' where id = '019965b7-97de-73c4-8ebd-acb4cb33ac20';

-- 2024-09-26 | Kihei | Green Church -> Kalepolepo
-- Could be HS1550 or HA1325 (both owned at this time, no way to distinguish); HA1325 chosen
-- arbitrarily per rider
update dwlist set foil = 'Armstrong HA1325', foil_confidence = 'medium' where id = '019965b7-97de-71a1-9f77-040717b02c58';

-- 2024-11-28 | Kihei | Sugar Beach -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7599-82d4-27e8a34b1480';

-- 2024-11-29 | Kihei | Green Church -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-79b3-82d9-5bbfb82891b0';

-- 2024-12-09 | Kihei | Sugar Beach -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7d27-8c34-c432d5ba67e5';

-- 2024-12-11 | Kihei | Sugar Beach -> Kalepolepo
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7b2a-871b-a0500680e095';

-- 2024-12-11 | Kihei | Green Church -> Kalepolepo
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-781c-b89a-6d5d4e90ef9c';

-- 2024-12-12 | Kihei | Sugar Beach -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7148-828b-00ed1ebfcfaf';

-- 2024-12-31 | Kihei | Sugar Beach -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7fe3-abfb-26364a6df357';

-- 2025-01-01 | Kihei | Sugar Beach -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7d51-a1c5-e0c02b4d50be';

-- 2025-01-07 | Kihei | Kam II -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7b3f-881b-41db8a4a71d7';

-- 2025-01-10 | Kihei | Green Church -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7f9d-8da8-4e2f560d7fa0';

-- 2025-01-13 | Kihei | Sugar Beach -> Kam I
-- HA980 era: rider used it exclusively once acquired, until switching to KT gear
update dwlist set foil = 'Armstrong HA980', foil_confidence = 'high' where id = '019965b7-97de-7ecc-add5-560b23a2ce1d';

-- 2025-01-18 | Kihei | Sugar Beach -> Kam I
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7685-9922-693c7713276f';

-- 2025-01-19 | Kihei | Sugar Beach -> Kam I
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-78cb-8283-498766bf839c';

-- 2025-01-20 | Kihei | Sugar Beach -> Kam I
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-74d3-89f2-9adffda22190';

-- 2025-02-25 | Kihei | Sugar Beach -> Kam I
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7d42-8911-6b40cea0cd86';

-- 2025-03-07 | Kihei | Sugar Beach -> Kam II
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7965-9562-bee18fb57de5';

-- 2025-03-10 | Kihei | Sugar Beach -> Kam II
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7af8-a5f8-1c50cd921d85';

-- 2025-04-05 | Kihei | Sugar Beach -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7b7b-8042-8d05ed8e0137';

-- 2025-04-06 | Kihei | Sugar Beach -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7108-b4fa-b10162b919d9';

-- 2025-04-08 | Kihei | Keālia Boardwalk -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7963-8347-10e8854faa4b';

-- 2025-04-09 | Kihei | Keālia Boardwalk -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-756a-af5f-719401307a0f';

-- 2025-04-11 | Kihei | Keālia Boardwalk -> Kam II
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-794b-b171-9f620f00b099';

-- 2025-04-19 | Kihei | Keālia Boardwalk -> Kam II
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7aa0-83e6-fbd21be270da';

-- 2025-04-19 | Kihei | Keālia Boardwalk -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7fc5-a54b-9837b46360da';

-- 2025-04-21 | Kihei | Sugar Beach -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7f58-9e04-a451a64b9d2f';

-- 2025-04-30 | Maui North Shore | Maliko -> Kanaha
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7535-b88c-1746adcf159e';

-- 2025-05-06 | Maui North Shore | Maliko -> Sugar Cove
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-77ab-880c-eaadf63917c3';

-- 2025-05-08 | Kihei | Sugar Beach -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7ed2-8cba-9206447e15b5';

-- 2025-05-12 | Kihei | Sugar Beach -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-78ab-bc88-e6db00917802';

-- 2025-05-13 | Maui North Shore | Maliko -> Sugar Cove
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-795d-8130-0d1c5559b5e1';

-- 2025-05-16 | Maui North Shore | Maliko -> Kanaha
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7a7d-9be1-6f0013f7d1ed';

-- 2025-05-17 | Maui North Shore | Maliko -> Kahului Harbor
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7b9e-813d-e571dc49eca8';

-- 2025-05-18 | Maui North Shore | Maliko -> Kahului Harbor
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7fb4-9418-a6a26f843f7d';

-- 2025-05-19 | Maui North Shore | Maliko -> Kahului Harbor
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-79e7-a430-a69332f8bb17';

-- 2025-05-20 | Kihei | Keālia Boardwalk -> Wailea
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7151-bd85-efdaea681c1f';

-- 2025-05-22 | Kihei | Green Church -> Mokapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7a5c-ae2b-55034d0a1a0c';

-- 2025-05-23 | Kihei | Keālia Boardwalk -> Ulua
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-78cc-b1ed-b0b0c4370f28';

-- 2025-05-23 | Kihei | Green Church -> Keawakapu
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-74d5-b4c3-d0637942879e';

-- 2025-05-24 | Kihei | Keālia Boardwalk -> Ulua
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7cbd-be8c-868076c17532';

-- 2025-05-25 | Maui North Shore | Maliko -> Kahului Harbor
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7278-a54c-70c4226711aa';

-- 2025-05-26 | Kihei | Keālia Boardwalk -> Ulua
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7a63-8645-3263035078fc';

-- 2025-05-29 | Kihei | Keālia Boardwalk -> Ulua
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7dfb-815c-4f126ebe6e67';

-- 2025-05-31 | Maui North Shore | Maliko -> Kahului Harbor
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-76cb-b22d-be1bdbbe8a2d';

-- 2025-06-01 | Maui North Shore | Maliko -> Kahului Harbor
-- KT Atlas 960 era: after switching to KT gear, before the Atlas 790 was introduced anywhere
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7e55-b506-5bb90ea1025e';

-- 2025-06-04 | Oahu South Shore | Kaiko'os -> Tonggs
-- Oahu South Shore before the first confirmed Atlas 790 use there (2025-06-07, Voyager camp)
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7467-9a5c-503f870c76a4';

-- 2025-06-05 | Oahu South Shore | China Walls -> Kaimana
-- Oahu South Shore before the first confirmed Atlas 790 use there (2025-06-07, Voyager camp)
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7fd6-8caf-373462fb6165';

-- 2025-06-06 | Oahu South Shore | China Walls -> Kaimana
-- Oahu South Shore before the first confirmed Atlas 790 use there (2025-06-07, Voyager camp)
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7b5b-ae6a-747cef1d3203';

-- 2025-06-10 | Maui North Shore | Maliko -> Kanaha
-- Maui North Shore before the first confirmed Atlas 790 use there (2025-06-12)
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019965b7-97de-7ffa-a50f-3e542697f874';

-- 2025-06-26 | Kihei | Green Church -> Ulua
-- Between confirmed Atlas 790 use (06-24) and a single-day Atlas 960 exception (06-30); 790
-- was the dominant foil in this window
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'medium' where id = '019965b7-97de-746f-af09-5c6e7206b038';

-- 2025-06-27 | Kihei | Keālia Boardwalk -> Mai Poina
-- Between confirmed Atlas 790 use (06-24) and a single-day Atlas 960 exception (06-30); 790
-- was the dominant foil in this window
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'medium' where id = '019965b7-97de-7ac5-9e5c-d5484a9c75e2';

-- 2025-06-27 | Kihei | Green Church -> Ulua
-- Between confirmed Atlas 790 use (06-24) and a single-day Atlas 960 exception (06-30); 790
-- was the dominant foil in this window
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'medium' where id = '019965b7-97de-7721-88f8-41fb17f4f894';

-- 2025-06-29 | Maui North Shore | Maliko -> Kahului Harbor
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019965b7-97de-7522-a07e-a64a834ca82b';

-- 2025-07-04 | Maui North Shore | Maliko -> Kahului Harbor
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019965b7-97de-7a82-8ea8-58c71179d273';

-- 2025-07-04 | Kihei | Keālia Boardwalk -> Ohukai Rd
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019965b7-97de-72db-8721-1472b20424d5';

-- 2025-10-17 | Kihei | Green Church -> Wailea
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '0199f582-3692-76e6-ad15-ce4507be10c5';

-- 2025-10-19 | Kihei | Keālia Boardwalk -> Wailea
-- Rider recalled riding an unlisted foil, an F-One Momentum 717, on a day it took a long
-- time to paddle up, on the Boardwalk -> Wailea route; this run has by far the longest
-- distance_to_first_paddle_up (2136m) of any Boardwalk -> Wailea run in the dataset
update dwlist set foil = 'F-One Momentum 717', foil_confidence = 'high' where id = '0199ff9c-f301-7d73-af72-a9f0479115ff';

-- 2025-10-28 | Kihei | Ohukai Rd -> Wailea
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019a2e4d-297c-7f43-9ec3-448bb969fabd';

-- 2025-11-09 | Kihei | Ohukai Rd -> Wailea
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019a6bd9-d067-7944-884f-3333e1aa0d0a';

-- 2025-11-16 | Kihei | Green Church -> Keawakapu
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019a9029-7b9b-7952-ab4b-727c1c74dc36';

-- 2025-11-18 | Kihei | Green Church -> Wailea
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019a9a0d-5a96-7416-b2e6-111b5f1787ee';

-- 2025-12-13 | Kihei | Keawakapu II -> Green Church
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019b1a3c-b04f-7d4f-8f85-f4bd502c6df2';

-- 2025-12-14 | Kihei | Wailea -> Green Church
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019b1f6c-329e-7730-a2f3-e324e26ed9db';

-- 2025-12-15 | Kihei | Wailea -> Green Church
-- Sandwiched by confirmed Atlas 790 use within a few days on both sides
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'high' where id = '019b259a-5fba-7eb1-8f70-69b3e76466e6';

-- 2026-01-01 | Maui North Shore | Maliko -> Kahului Harbor
-- Falls within a window where Kihei shows Atlas 960 resurgence (12-30, 01-03, 01-13, 01-23),
-- but no direct Maui North Shore confirmation nearby; moderate wind (19.1kn)
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'low' where id = '019b7c77-e746-7469-97d9-d0a9c911499d';

-- 2026-01-02 | Kihei | Keālia Boardwalk -> Maluaka
-- Sandwiched directly between two confirmed Atlas 960 dates (2025-12-30 and 2026-01-03)
update dwlist set foil = 'KT Atlas 960', foil_confidence = 'high' where id = '019b81d7-3576-71c4-a201-548d603a751f';

-- 2026-01-06 | Maui North Shore | Maliko -> Kahului Harbor
-- Falls within the Atlas 960 resurgence window by date, but unusually high wind (26.1kn) is
-- more consistent with typical Atlas 790 conditions
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'low' where id = '019b9694-ac68-7055-88dc-2c4a006b4e29';

-- 2026-01-14 | Kihei | Maluaka -> Green Church
-- Between confirmed Atlas 960 (01-13, low wind) and confirmed Atlas 790 (01-15); the high
-- wind that day (25.2kn) favors Atlas 790
update dwlist set foil = 'KT Atlas 790', foil_confidence = 'low' where id = '019bc02d-3ffa-7f66-909c-8a805271c64d';

commit;
