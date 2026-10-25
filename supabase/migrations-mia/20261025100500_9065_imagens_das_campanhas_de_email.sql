-- manifest: O DISPARO DE E-MAIL MARKETING, PARTE 6 (.89): o bucket PRIVADO `email-marketing-imagens` (1 MB por arquivo, PNG, JPEG e GIF), onde mora a imagem dos blocos de campanha. Privado porque o unico bucket publico da instalacao e o `brand-logos` do upstream; a imagem de um e-mail e aberta pelo programa de e-mail de quem recebe, sem sessao e por anos (um link assinado venceria), entao o e-mail aponta para a rota publica `GET /api/v1/webhooks/email-marketing/imagem/<empresa>/<uuid>.<ext>`, que le daqui com o service_role e devolve a imagem com cache longo; o uuid do servidor e o que nao se adivinha. So entra material de campanha (a rota `POST /api/v1/email-marketing/imagens` confere papel, modulo e os primeiros bytes do arquivo), nunca dado de contato; o caminho e `<empresa>/<uuid>.<ext>`. Escrita so pelo servidor (service_role), sem politica de storage para authenticated. Idempotente e auto-curativo (`on conflict do update`), como o `brand-logos` do upstream. Nenhum objeto do upstream e tocado.
--
-- 9065 · as imagens das campanhas de e-mail
--
-- Só objeto NOSSO (docs/FORK-MIA.md, regra 3). O bucket é PRIVADO: o único
-- bucket público da instalação é o `brand-logos` do upstream (tests/invariants/
-- marca-logo.test.ts). O e-mail aponta para a rota pública nossa que lê daqui
-- (`/api/v1/webhooks/email-marketing/imagem/<empresa>/<uuid>.<ext>`).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-marketing-imagens', 'email-marketing-imagens', false, 1048576, array['image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
