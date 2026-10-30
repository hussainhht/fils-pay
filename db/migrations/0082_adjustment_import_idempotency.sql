-- Same parsed adjustment rows must not post twice. The filename is not an
-- identity. Existing imports have no hash (NULL); new imports always set one.
-- Multiple NULLs are allowed so this can land on a table that already has rows.

ALTER TABLE adjustment_imports
    ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX adjustment_imports_content_hash_key
    ON adjustment_imports (content_hash)
    WHERE content_hash IS NOT NULL;
