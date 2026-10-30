# Contatos em massa (1.21.0-mia.97)

Três defeitos vividos pelo dono em 29/10/2026, ao importar uma planilha de 565 contatos
para etiquetar e disparar uma campanha. Sem migration: o carimbo do schema não muda.

## 1. A importação de CSV perdia o telefone

**Causa.** `phone` não estava em `HEADER_ALIASES` (`lib/contacts/csv.ts`). A coluna era
ignorada em silêncio: a linha com e-mail entrava sem o número, e a linha só com telefone
virava "linha sem telefone nem e-mail". O formato do número não tinha culpa:
`+55 (31) 991580789` passa pela `normalizePhoneBR` sem problema.

**Conserto.**

- `phone` e os nomes comuns em inglês entraram nos apelidos.
- **Reimportar completa** (`lib/contacts/completar-na-importacao.ts`): quem existe pelo
  e-mail e não tem telefone ganha o da linha, e o contrário também. Telefone e e-mail que
  já existem nunca são trocados; telefone de um contato com e-mail de outro não muda nada
  e avisa; contato anonimizado não é tocado. Cada contato completado tem auditoria própria
  (`contact.updated`, com o de-para) e **não** emite `contact.phone_added`: importação não
  dispara a automação de "ganhou um telefone", para não virar um disparo em massa.
- **O resumo diz o que aconteceu**: telefones e e-mails completados, quantos vieram sem
  telefone, as colunas ignoradas e o aviso quando nenhuma coluna foi lida como telefone.
- **O teto dos contatos subiu para 2.000 linhas** (`CSV_MAX_CONTATOS_POR_ARQUIVO`): a
  planilha tinha 565, e os 500 de sempre recusariam o arquivo inteiro. Negócios e produtos
  continuam em 500, onde cada linha custa bem mais.
- A leitura de quem já existe passou a ir em lotes (`buscaEmLotes`) e a recusar quando
  falha. Antes, um `.in()` com centenas de e-mails passava do teto da URL, o erro era
  ignorado, e todo mundo caía no 23505 como "duplicado".
- Do upstream veio o filtro `is_merged_into` nessa leitura (#3620, EPIC-05).

## 2. A etiqueta em massa parava em 100

**Causa.** A barra só conhecia os ids marcados, e `POST /api/v1/contacts/bulk` recusa mais
de 100 por chamada (`bulk_too_large`).

**Conserto.** O padrão de sempre: marcar a página e oferecer estender ao filtro.

- `GET /api/v1/contacts?com_total=true` traz o tamanho do filtro em `meta.total`, pelo mesmo
  handler da lista, só quando a faixa precisa dele.
- `POST /api/v1/contacts/bulk/filtro` anda **uma parte por chamada** (até 100) e devolve o
  `cursor`. Quem entra é decidido pelo `listContactsHandler`, e o que acontece com cada um,
  pela rota de lote de sempre: permissão, auditoria por contato e recusa por item seguem
  iguais, nas três ações (etiqueta, responsável, campo personalizado).
- A tela repete até acabar (`lib/contacts/lote-em-partes.ts`), com o andamento na barra.
  A seleção marcada à mão também passou a ir em partes: mais de 100 linhas não dá mais 422.
- Se a chamada falhar no meio, o aviso diz quantos já foram e pede para repetir.

**Por que a tela repete, e não um trabalho no servidor.** Um trabalho em segundo plano
pediria fila, tabela e migration. Tudo em um pedido só amarraria milhares de escritas a um
HTTP que um proxy pode derrubar. O custo: fechar a tela para o que falta; a barra avisa, e
repetir não estraga nada.

**Papel e empresa.** `agent` para etiqueta e campo, `manager` para responsável (recusa na
chamada, e não uma por contato). A organização vem da sessão, e a leitura usa o cliente da
sessão (RLS). O filtro marcado é guardado inteiro: mudar o filtro limpa a seleção, e a ação
nunca vale para outra lista.

**Automação.** A etiqueta pela tela emite `contact.tag_added`, como sempre, e isso agora
pode alcançar a base inteira. A confirmação avisa antes do clique.

## 3. A campanha filtrada pela etiqueta deu "0 destinatários"

Na conferência saiu "0 destinatários · 0 sem telefone · 0 repetidos · 0 pediram para sair ·
0 contatos pessoais", com 25 contatos na etiqueta, todos sem telefone.

**O que foi medido.** A peneira conta certo: com a lista certa, os 25 viram "25 sem
telefone" (`tests/unit/disparo-conferencia-do-filtro.test.ts`). Quatro zeros querem dizer
que **a lista veio vazia**, porque a peneira só vê quem passou no filtro. Contra o PostgREST
real (v14.14), etiqueta com espaço casa, e o `ov` compara byte a byte: `Leads Odonto JHS`
**não** acha `leads odonto jhs`. Isso reproduz a tela exata.

**O que não dá para saber sem olhar a produção.** O seletor oferece a grafia gravada, então
por ele a caixa não erra. Por ele, a lista só sai vazia com **etiqueta E etapa juntas** em
contatos sem negócio aberto (o caso de quem acabou de importar). A auditoria não guardava o
filtro, então a causa daquela tentativa não ficou registrada. Agora fica.

**Conserto** (fecha os dois caminhos):

- A etiqueta casa **sem olhar maiúscula**: o filtro procura todas as grafias gravadas da
  mesma etiqueta (`fn_contact_tags`, a função do seletor) e a minúscula.
- Etiqueta com vírgula é uma etiqueta só (o `overlaps` monta `{a,b}` sem aspas).
- A lista tem o **mesmo recorte do seletor**: sem anonimizado, ficha absorvida nem grupo.
- A conferência conta **"N sem negócio aberto na etapa"**, e quatro zeros agora vêm com a
  frase do que conferir. O toast de "Lista remontada" diz os motivos também.
- `broadcast.criado` guarda o filtro e quem ficou de fora.

## 4. O MCP

`plataforma_etiquetar_contatos` (operação `importar_base`): o mesmo filtro da tela, com
`apenas_contar` para conferir antes e `cursor` para andar de 1.000 em 1.000. Não emite
`contact.tag_added`, como `plataforma_importar_contatos`: pelo token, uma regra "ganhou a
etiqueta, envia mensagem" viraria um disparo sem ninguém olhando. Sem filtro, recusa, salvo
com `toda_a_base: true`. A reimportação que completa telefone não precisa de ferramenta:
`plataforma_importar_contatos` já completa.

## 5. Os pontos de ligação no código do upstream

Tudo marcado com `FORK MIA (.97)`.

| arquivo do upstream | o que mudou |
|---|---|
| `lib/contacts/csv.ts` | apelidos, `CSV_MAX_CONTATOS_POR_ARQUIVO`, `colunasIgnoradas` |
| `app/api/v1/contacts/import/route.ts` | leitura em lotes, decisão por linha, resumo |
| `app/api/v1/contacts/_handler.ts` | `opcoes.comTotal` e `total` em `listContactsHandler` |
| `app/api/v1/contacts/route.ts` | `?com_total=true` |
| `hooks/contacts/useBulkContacts.ts` | `mutationFn` em partes, `progresso`, avisos |
| `hooks/contacts/useImportContacts.ts` | campos novos do resumo |
| `components/contacts/ImportContactsDialog.tsx` | o resumo |
| `components/contacts/BarraDeContatosEmLote.tsx` | `deFiltroInteiro`, `progresso` |
| `app/app/contacts/_client.tsx` | a faixa e o filtro marcado |

O teto de `app/api/v1/contacts/bulk/route.ts` não mudou: quem repete é o cliente. Na próxima
fusão, o upstream muda a mesma leitura da importação (`contatosDonosDosExtras`, telefone
extra da ficha): ela entra na lista de quem é conhecido, sem mudar a decisão por linha.
