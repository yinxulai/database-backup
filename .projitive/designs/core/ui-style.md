---
applyTo: "**"
---

# UI Style Guide - Database Backup

> This is a backend-first CLI/K8s tool. UI style is for future web management interface.

---

## 1. Design Principles

1. **Minimal UI** - CLI first, web UI later
2. **Clear feedback** - Show progress and status prominently
3. **Consistent patterns** - Use shadcn/ui components when web UI is built

---

## 2. Color Palette

For future web management interface:

| Token | Value | Usage |
|-------|-------|-------|
| primary | #2563eb | Primary actions, links |
| success | #16a34a | Completed backups, success states |
| warning | #ca8a04 | Pending, warnings |
| error | #dc2626 | Failed backups, errors |
| background | #0f172a | Dark mode background |

---

## 3. Component Patterns

Use shadcn/ui components:
- Button for actions
- Card for task display
- Table for backup history
- Badge for status
- Progress for backup progress

---

## 4. Status Colors

| Status | Color | Badge |
|--------|-------|-------|
| pending | yellow | 🟡 |
| running | blue | 🔵 |
| completed | green | 🟢 |
| failed | red | 🔴 |

---

## 5. CLI Output

```
$ db-backup run --task my-backup
[2026-04-18 09:45:00] Starting backup: my-backup
[2026-04-18 09:45:01] Connecting to PostgreSQL...
[2026-04-18 09:45:02] Connected ✓
[2026-04-18 09:45:03] Dumping tables: users, orders, products
[2026-04-18 09:45:10] Dumped 3 tables (15.2 MB)
[2026-04-18 09:45:11] Uploading to S3...
[2026-04-18 09:45:15] Uploaded ✓ (backup/postgresql-db-2026-04-18.sql.gz)
[2026-04-18 09:45:16] Backup completed in 16s
```

---

## 6. Accessibility

- All interactive elements keyboard accessible
- Status announcements for screen readers
- Minimum contrast ratio 4.5:1
