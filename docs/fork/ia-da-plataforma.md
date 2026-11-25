# A IA de toda empresa segue a da plataforma

**Versão:** .117 (MIA-215; núcleo na MIA-217, superfície na MIA-218; desenho na MIA-216).

## 1. A regra

A IA de toda empresa é a da plataforma, salvo escolha explícita. Quem escolhe o par
(provedor e modelo) da plataforma é o administrador da plataforma, em **Admin › Modelo de IA**
(`/admin/modelo-de-ia`, tabela `platform_ia`). Trocar ali troca, de uma vez, todas as empresas que
seguem a plataforma.

A escolha por empresa continua existindo, como exceção. É do administrador da plataforma, na tela
**IA › Provedores de IA** da empresa, que ele abre em modo suporte com "Edição permitida". Salvar o
cartão "Modelo padrão" ali é a escolha própria: a empresa deixa de seguir a plataforma.

A chave é da plataforma (`lib/ai/custo-e-da-plataforma.ts`): a empresa não cadastra nada. Uma chave
própria da empresa é opção avançada, só para o administrador da plataforma fora de suporte.

## 2. Por que existe

Em 24/11/2026, a maior parte das empresas estava no padrão do produto do upstream
(anthropic/claude-sonnet-5), gravado por `fn_seed_org_llm_defaults` quando cada uma nasceu. A
instalação não tem chave da Anthropic, e nenhuma delas tinha chave própria. Nenhuma fez uma chamada
de IA por semanas, e ninguém viu. A troca em `/admin/modelo-de-ia` não chegava a elas: valia só para
agente novo e para a primeira publicação.

Três coisas pioravam:

- o aviso do upstream na tela Provedores ("Você ainda não cadastrou a chave da sua IA principal")
  fez o próprio dono da instalação achar que precisava cadastrar chave;
- o administrador da plataforma, em modo suporte, não conseguia salvar o padrão da empresa
  (`escolheIa` recusava toda sessão de suporte);
- o MCP de plataforma não tinha como ver isso.

## 3. Como funciona

| Peça | Onde | O que faz |
|---|---|---|
| Quem segue | `organizations.ia_segue_a_plataforma` (migration 9172) | `true`: o par da empresa é o de `platform_ia`. `false`: escolha própria. |
| A invariante | gatilhos `trg_ia_segue_a_plataforma` (em `organizations`) e `fn_mia_platform_ia_propaga` (em `platform_ia`) | Mantêm `settings.llm` igual a `platform_ia` para quem segue. O tempo de execução continua lendo `settings.llm` e não mudou. |
| Empresa nova | o mesmo gatilho, antes do seed do upstream | Nasce seguindo, com o par da plataforma. Com molde de IA (9096), o molde vence e ela nasce com escolha própria. |
| A função única | `lib/ai/ia-da-empresa.ts` (`iaDaEmpresa`, `iaDasEmpresas`) | Por empresa: o par em vigor, a origem (`plataforma` ou `propria`) e a chave utilizável (`propria`, `instalacao` ou nenhuma). |
| A trava | PATCH e PUT de `/api/v1/ai/providers`, PUT de `/api/v1/admin/modelo-de-ia` | Recusa com 422 `ia_sem_chave` salvar um padrão num provedor sem chave utilizável. |
| Modo suporte | `escolheIa` (`lib/ai/trava-da-ia.ts`) | O administrador da plataforma em modo suporte com edição, aberto pela plataforma, escolhe a IA da empresa (seção 4). |
| O aviso da chave | `AvisoDaChave.tsx` (tela Provedores) | "Usando a chave da MIA. Nenhuma chave precisa ser cadastrada." A chave própria aparece como opção avançada, só para o administrador da plataforma. |
| O aviso da trava | a tela Provedores, a `/health` (`data.ia`), o relatório interno e o MCP | Avisam quando uma empresa fica com o padrão num provedor sem chave utilizável (seção 5). |
| O MCP | `plataforma_ver_ia_das_empresas` | Leitura, por empresa (seção 6). Trocar modelo não tem ferramenta. |

A migration 9172 também consertou as empresas que existiam: passou a seguir a plataforma quem estava
no padrão semeado sem chave própria da Anthropic, ou já no par da plataforma sem chave própria
daquele provedor. Cada empresa alterada tem uma linha de auditoria
(`ai.padrao_passou_a_seguir_a_plataforma`). Quem tinha escolhido outro par de propósito ficou como
estava.

## 4. Modo suporte

O administrador da plataforma não é membro das empresas. A única porta dele para a tela Provedores
de IA de uma empresa é o modo suporte. `escolheIa` deixa passar quem é, ao mesmo tempo:

- administrador da plataforma com `scope = full` (o `support_readonly` só lê);
- numa sessão de suporte **ativa**, em modo **"Edição permitida"** (`access_mode = full`);
- aberta pela **plataforma**, e não por uma agência (`agency_id` vazio).

A empresa é a da sessão: em suporte, a organização ativa é sempre a do acompanhamento. A abertura da
sessão já exigiu MFA.

A **chave** fica de fora, mesmo com edição: as portas da chave (`credentials/[id]`, a chave do
onboarding e o link da chave própria na tela) usam `podeConfigurarChaveDeIa`, que continua sem
suporte. Acompanhar não é ver a nossa chave nem o nosso custo.

## 5. O aviso da trava

A trava recusa o caminho comum. O aviso pega o que sobra: a chave da instalação saiu do ambiente,
uma chave própria foi desativada, ou `platform_ia` ficou vazio numa instalação sem chave da
Anthropic. A regra é pura e mora em `lib/ai/aviso-da-ia-das-empresas.ts`. Conta só empresa operante
(`ehOperante`). A demonstração conta, porque é usada em venda.

Todos leem a mesma régua, `iaDasEmpresas` ou `iaDaEmpresa` (`lib/ai/ia-da-empresa.ts`), e por isso
dizem o mesmo número.

`iaDasEmpresas` lê `organizations` e `ai_provider_credentials` em páginas de 1000, ordenadas por
`id`, até o fim (`lerTodasAsPaginas`, `lib/leitura/todas-as-paginas.ts`, MIA-235): o PostgREST corta
cada resposta em 1000 linhas sem avisar, e a conta parava na empresa 1000. Página que falhou, ou o
teto de 100 páginas sem chegar ao fim, devolve `null` ("não sei"), nunca a conta de um recorte.

- **`/health`**: `data.ia.empresas_sem_chave`, só a contagem, sem id nem nome, igual com e sem o
  segredo. A leitura tem o mesmo teto de tempo das outras da saúde; `null` quer dizer que ela falhou
  (diferente de zero). **Não muda o `status`**: o passo 1 do trem de implantação lê o `status`, e
  uma empresa mal configurada não pode travar a implantação.
- **Relatório interno** (`cron/report-da-plataforma`, seção 3b): o cron roda de minuto em minuto, e
  esta parte lê as empresas só a cada 15 minutos. Enquanto houver empresa sem chave, sai um recado
  por dia (chave `ia_das_empresas_sem_chave`), com a contagem, onde ver quais e onde corrigir. Sem
  nome de empresa. Leitura que falhou não avisa.
- **Tela Provedores** (`AvisoDaChave`, sobre `ia.chave` do GET):
  - `instalacao`: "Usando a chave da MIA. Nenhuma chave precisa ser cadastrada.";
  - `null`: quem escolhe a IA (a plataforma em suporte) lê "A IA principal desta empresa (provedor)
    está sem chave e não responde aos clientes. Escolha no padrão abaixo um provedor com chave."; a
    empresa lê que é com o suporte, sem link;
  - `propria`, ou `ia` nulo (leitura falhou): nada.
- **Admin › Modelo de IA** (`ContagemDasEmpresas`, sobre `empresas` do GET): o cartão diz "Vale para
  todas as empresas que não escolheram outro." e mostra quantas seguem, quantas têm escolha própria
  e quantas estão sem chave. Com alguma sem chave, diz o efeito e aponta o MCP. `null`: nada.

## 6. MCP

| Ferramenta | O que faz | Tipo |
|---|---|---|
| `plataforma_ver_ia_das_empresas` | por empresa: se segue a plataforma ou tem escolha própria, o provedor e o modelo em vigor, e se há chave utilizável (`propria`, `instalacao` ou `null`). Traz também a `contagem` (`contarEmpresas`: só as operantes), os mesmos números do cartão do admin, da `/health` e do relatório interno; a suspensa aparece com `operante: false` e não conta. Nada da chave em si sai. Filtros: `organization_id` (uma empresa) e `so_sem_chave`; as sem chave vêm primeiro | leitura |

**Não há ferramenta de troca.** Trocar modelo é ato de pessoa, com MFA, no painel: em
`/admin/modelo-de-ia` (todas as que seguem) ou na tela Provedores da empresa, em modo suporte (uma).
É a mesma doutrina do MCP de agentes.

## 7. O que fica fora

- Um botão "Voltar a seguir a plataforma" no cartão do padrão. Sem ele, a empresa que virou escolha
  própria só volta a seguir por migration. Se o Gabriel quiser, vira proposta, porque muda a tela.

## 8. Como conferir depois de uma fusão

1. `git grep -n "FORK MIA" -- lib/agent-engine/edge/llm/credentials.ts app/api/v1/ai/providers/route.ts app/api/v1/admin/modelo-de-ia/route.ts`: os pontos do núcleo vivos.
2. `git grep -n "plataformaEditaEmSuporte" -- lib/ai/trava-da-ia.ts`: o modo suporte continua no `escolheIa`.
3. O upstream mexeu em `fn_seed_org_llm_defaults` ou criou um "padrão da instalação"? Confira que o
   gatilho `trg_ia_segue_a_plataforma` continua rodando antes do seed (ordem alfabética dos BEFORE).
4. Rode `lib/ai/trava-da-ia.test.ts`, `app/api/v1/ai/providers/modo-suporte-escolhe-a-ia.test.ts`,
   `app/app/ai/providers/_components/AvisoDaChave.test.tsx`,
   `components/admin/modelo-de-ia/ContagemDasEmpresas.test.tsx`,
   `app/api/v1/health/health-diz-se-ha-empresa-sem-ia.test.ts`,
   `tests/unit/report-da-plataforma-ia-sem-chave.test.ts`, `lib/ai/aviso-da-ia-das-empresas.test.ts`
   e `tests/unit/mcp-de-implantacao-ia-das-empresas.test.ts`.
5. O upstream mexeu na `/health` ou no relatório interno? Confira com
   `git grep -n "MIA-218" -- app/api/v1/health/route.ts app/api/v1/cron/report-da-plataforma/route.ts`.
