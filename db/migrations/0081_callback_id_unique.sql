-- One acquirer callback_id is one note. Redeliveries were inserted again
-- because callback_id was not unique. Keep the earliest row for each id
-- (first write wins, same as ON CONFLICT DO NOTHING) and then enforce it.

DELETE FROM acquirer_callback_notes AS extra
 USING acquirer_callback_notes AS kept
 WHERE extra.callback_id = kept.callback_id
   AND (extra.created_at, extra.id) > (kept.created_at, kept.id);

CREATE UNIQUE INDEX uq_acquirer_callback_notes_callback_id
    ON acquirer_callback_notes (callback_id);
