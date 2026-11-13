-- App 0.5.1 (13 November 2026): no recording matched on the first beta phones, and a "missing" report said nothing
-- about why. The phone now says how many audio files were in the call's window and how close the best one came.
-- Never a file name. Older apps send none of this; the columns stay null.

alter table recordings
  add column files_in_window int null,
  add column best_score int null,
  add column best_folder varchar(200) null,
  add column best_audio_seconds int null,
  add column best_offset_seconds int null;
