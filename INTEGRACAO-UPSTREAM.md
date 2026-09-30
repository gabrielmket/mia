# Integração com o upstream — o que a análise achou

**Branch:** `integracao-upstream` (árvore isolada em `DeskcommCRM-integracao`)
**Backup do banco:** `DeskcommCRM-backups/mia-producao-20260923-1549.dump` — 6,8 MB, 193 tabelas, verificado com `pg_restore --list`
**Produção durante tudo isso:** intocada, rodando `1.21.0-mia.54`

## O tamanho

| | |
|---|---|
| Commits do upstream que não temos | 2.764 |
| Arquivos em conflito | 66 (de 135 compartilhados) |
| Blocos de conflito | 116 |
| Migrations com número duplicado | 29 |
| Teto de numeração do upstream | **0390** (não 0387) — as nossas vão para 0391+ |

## A decisão de método, já tomada

**Merge, não rebase.** Um rebase dos nossos 151 commits para 338 vezes, e 117 dessas
paradas são nos mesmos três arquivos (`dicionario.ts` 46, `baseline.sql` 37,
`MANIFEST.md` 34). Um merge paga cada conflito uma vez.

**O `baseline.sql` não se funde, se regenera.** São 15.275 linhas dentro de marcadores.
O caminho é: tomar o dele inteiro, e reaplicar por cima (a) os dois retoques cirúrgicos
nossos e (b) o nosso apêndice, na ordem.

## As treze que quebram em SILÊNCIO

Estas são as que não dão erro, não reprovam teste e só aparecem depois. Cada uma
precisa ser conferida à mão antes de qualquer implantação.

1. **`NAMESPACE_DESTE_REPO` volta a ser `ghcr.io/melgarafael`** — o upstream moveu esse
   literal para um arquivo novo. Arquivo novo não gera conflito: entra inteiro, com o
   valor dele. Efeito: a produção passa a baixar as imagens DELE.

2. **O CI de publicação (778 linhas em conflito)** — a matriz dele publica
   `deskcommcrm` / `deskcomm-worker` / `deskcomm-scheduler` / `deskcomm-voice-agent`;
   a nossa publica `mia-crm` / `mia-worker` / `mia-scheduler`. Resolver pelo lado errado
   quebra o deploy do EasyPanel sem uma mensagem de erro.

3. **O cookie de sessão volta a ser o do upstream** — derruba o login em produção.

4. **`meta_billable` (custo da Meta por mensagem) some** sem quebrar nada. É a nossa
   medição de custo por cliente.

5. **`fn_lgpd_cascade_redact_contact`** — o único objeto que os DOIS reescrevem.
   A dele redige 20 tabelas, a nossa 9. Quem entrar por último vence, calado.
   - Se a nossa vencer: 11 tabelas deixam de ser redigidas (buraco de LGPD que só
     aparece quando um cliente real pedir exclusão).
   - Se a dele vencer: os nossos 4 campos param de ser redigidos
     (`custom_fields`, `cargo`, `setor`, `empresa_id`).
   - **A fusão é bidirecional**, e três tabelas da versão dele não existem no nosso fork
     (`agent_case_chat_messages`, `passagens_de_atendimento`, `entregas_de_aviso_de_caso`).
   - Agrava: `SET check_function_bodies = false` na linha 7 do baseline — nem coluna
     inexistente no corpo é pega na hora de aplicar.

6. **`periodo_ambiguo` volta** — é o comportamento que travou o agendamento da Time Company.

7. **Dois conceitos diferentes chamados "módulos"** colidem em 8 arquivos, com a mesma assinatura.

8. **Disparo em massa construído duas vezes** — nossas `broadcasts` contra as `campaigns`
   dele (5 tabelas). Entram as duas, sem conflito.

9. **"Aviso no WhatsApp" construído duas vezes** — o nosso é de PLATAFORMA (um número
   para a instalação); o dele é por organização. Não cruzam um único arquivo, então o
   git não acusa nada: entram os dois.

10. **A voz não chega ao nosso deploy.** O agente de voz é uma QUARTA imagem
    (`deskcomm-voice-agent`). Nosso `docker-compose.easypanel.yml` tem três e esse
    arquivo não existe no upstream — o merge não o toca. Sem trabalho de compose, a voz
    entra no código e não sobe.

11. **O carimbo do schema não existe no upstream** — a catraca quebra em 4 asserções.

12. **`broadcast_recipients` deixa o gate de LGPD vermelho** e o merge não conserta sozinho.

13. **Janela de deploy**: 78 índices sem `CONCURRENTLY` e 21 constraints sem `lock_timeout`.

## O que o banco de produção aguenta

`bootstrap.sh:88` aplica o baseline **sem `ON_ERROR_STOP`, com `|| true`**. Medido:

- 20 tabelas novas nossas × 43 dele = **0 colisões de nome**
- 23 colunas novas nossas × 94 dele = **0 colisões**
- 27 índices nossos × 78 dele = **0 colisões**
- 166 funções em comum, **4 assinaturas divergentes**

**O banco não se perde.** O risco não é destruição, é degradação silenciosa — os treze
itens acima.

## Ordem de execução

1. Resolver os 66 arquivos (em curso)
2. Regenerar o `baseline.sql` (à mão, não é merge)
3. Fundir a cascata de LGPD nos DOIS sentidos
4. Renumerar as nossas 34 para 0391+ (com timestamp novo; não existe script, é preciso escrever)
5. Percorrer a lista dos treze, um a um
6. Suíte inteira + catracas
7. Só então cortar release e implantar

## O que ainda não resolvi

- O upstream anda ~1.700 linhas de baseline por dia e **mudou durante a própria análise**.
  Alvo móvel: em algum momento é preciso congelar um commit dele e integrar contra ele.
- Decidir o que fazer com as duas features duplicadas (disparo em massa, aviso no WhatsApp):
  ficar com uma, com as duas, ou fundir.
