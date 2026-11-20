-- 0071: Gujarat toll plazas missing from the plaza catalogue (owner, 20 Nov 2026).
--
-- Sources: IHMCL NH fee plaza list (Jul 2026, 64 Gujarat NH plazas = the ULIP
-- TOLL/01 list), GSRDC state-highway toll list, Delhi-Mumbai Expressway notices.
-- Only plazas not already present under any spelling are added; names follow
-- the "<Place> Toll Plaza" form FASTag records use. seen_count starts at 0 and
-- coordinates are left null where no reliable source gave them.
-- Adds rows only; nothing existing is changed.

insert into public.toll_plazas (name, seen_count, lat, lng)
select v.name, 0, v.lat, v.lng
from (values
  ('Nadiad Toll Plaza', 22.697799, 72.896640),
  ('Pithadiya Toll Plaza', 21.805381, 70.663970),
  ('Vanana Toll Plaza', 21.664929, 69.709536),
  ('Dhumiyani Toll Plaza', 21.751451, 70.326793),
  ('Kuchadi Toll Plaza', 21.697537, 69.532810),
  ('Okhamadhi Toll Plaza', 22.080199, 69.133870),
  ('Dari Toll Plaza', 20.961287, 70.334349),
  ('Gadoi Toll Plaza', 21.425234, 70.295437),
  ('Nageshri Toll Plaza', 20.916389, 71.321944),
  ('Gorsar Toll Plaza', 21.318554, 69.909762),
  ('Bhordu Toll Plaza', 24.447181, 71.751233),
  ('Panthawada Toll Plaza', 24.493991, 72.268790),
  ('Danta Dharampur Toll Plaza', 22.145290, 69.410350),
  ('Limdi Toll Plaza', 23.034411, 74.152650),
  ('Tarana Toll Plaza', 22.741732, 70.488654),
  ('Bhirandiyara Toll Plaza', 23.634998, 69.692520),
  ('Rohisa Toll Plaza', 21.190534, 71.863850),
  ('Sundarpara Toll Plaza', 20.901721, 70.515003),
  ('Velva Toll Plaza', 20.805689, 70.813503),
  ('Kukma Toll Plaza', 23.212214, 69.793313),
  ('Varshamedi Toll Plaza', 23.146133, 70.108406),
  ('Nana Masera Toll Plaza', 24.587901, 71.719991),
  ('Budhanpur Toll Plaza', 24.419165, 71.650345),
  ('Tharad Toll Plaza', 24.378373, 71.646145),
  ('Jorawargadh Toll Plaza', 24.088442, 71.469401),
  ('Bakutra Toll Plaza', 23.797251, 71.196877),
  ('Samiyala Toll Plaza', 22.261190, 73.109785),
  ('Dahegam Toll Plaza', 21.693400, 72.924700),
  ('Baletiya Toll Plaza', null, null),
  ('Bed Toll Plaza', 22.427134, 69.913982),
  ('Desalpar Toll Plaza', 23.195710, 69.471140),
  ('Angiya Toll Plaza', 23.325460, 69.310380),
  ('Dhamadaka Toll Plaza', null, null),
  ('Tadkeshwar Toll Plaza', null, null),
  ('Keshrol Toll Plaza', 21.714897, 72.780845)
) as v(name, lat, lng)
where not exists (
  select 1 from public.toll_plazas p where lower(p.name) = lower(v.name)
);
