-- Seed the protected Demo customer organization.
-- Membership and credentials stay managed through the Admin Panel/API.

insert into public.spaces (name, slug)
values ('Demo', 'demo')
on conflict (slug) do update
set name = excluded.name;
