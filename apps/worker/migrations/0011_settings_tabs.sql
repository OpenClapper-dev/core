-- One settings file per tab (#426, second round): the page "project" is called General now, and every project's
-- Settings folder gets the pages Properties, Naming patterns and Customizations next to General and Extensions.
UPDATE files SET name = 'General', body = json_set(body, '$.page', 'general')
WHERE type = 'settings' AND json_extract(body, '$.page') = 'project';

INSERT INTO files (id, project_id, type, name, container, created_by, created_at, body, body_version)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  s.project_id, 'settings', p.name, s.id, s.created_by, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object('page', p.page), 1
FROM files s
JOIN (SELECT 'general' AS page, 'General' AS name UNION ALL SELECT 'properties', 'Properties' UNION ALL SELECT 'naming', 'Naming patterns'
      UNION ALL SELECT 'extensions', 'Extensions' UNION ALL SELECT 'customizations', 'Customizations') p
WHERE s.fixed = 'settings' AND s.project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files x WHERE x.container = s.id AND x.type = 'settings' AND json_extract(x.body, '$.page') = p.page);
