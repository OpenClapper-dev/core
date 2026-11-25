-- Settings as files (#426): every project's Settings folder gets its settings pages, Project and Extensions
-- (files of the type `settings` whose body names the page). New projects get them with the folder
-- (files.ts fixedFolders); a person's home gets its Settings folder and pages when it is first listed
-- (files.ts ensureHome). Ids are random UUIDs of version 4.
INSERT INTO files (id, project_id, type, name, container, created_by, created_at, body, body_version)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  s.project_id, 'settings', p.name, s.id, s.created_by, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), json_object('page', p.page), 1
FROM files s
JOIN (SELECT 'project' AS page, 'Project' AS name UNION ALL SELECT 'extensions', 'Extensions') p
WHERE s.fixed = 'settings' AND s.project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM files x WHERE x.container = s.id AND x.type = 'settings' AND json_extract(x.body, '$.page') = p.page);
