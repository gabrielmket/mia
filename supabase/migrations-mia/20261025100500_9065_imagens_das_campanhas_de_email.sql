-- manifest: O DISPARO DE E-MAIL MARKETING, PARTE 6 (.89): o bucket PUBLICO `email-marketing-imagens` (1 MB por arquivo, PNG, JPEG e GIF), onde mora a imagem dos blocos de campanha. Publico porque a imagem de um e-mail e aberta pelo programa de e-mail de quem recebe, sem sessao e por anos, e um link assinado venceria. So entra material de campanha (a rota `POST /api/v1/email-marketing/imagens` confere papel, modulo e os primeiros bytes do arquivo), nunca dado de contato; o caminho e `<empresa>/<uuid>.<ext>`. Escrita so pelo servidor (service_role), sem politica de storage para authenticated. Idempotente e auto-curativo (`on conflict do update`), como o `brand-logos` do upstream. Nenhum objeto do upstream e tocado.
--
-- 9065 · as imagens das campanhas de e-mail
--
-- Só objeto NOSSO (docs/FORK-MIA.md, regra 3).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-marketing-imagens', 'email-marketing-imagens', true, 1048576, array['image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
