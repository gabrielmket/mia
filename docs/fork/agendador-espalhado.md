# O agendador espalha as rotas dentro do minuto (MIA-341)

## O que muda

O agendador (`docker/scheduler/entrypoint.sh`) gera uma linha de crontab por rota de cron, e todas
chamavam o mesmo `app` no segundo zero do minuto. Com as 70 rotas de hoje, isso dava 18 chamadas
juntas a cada minuto, 35 nos múltiplos de 5, 42 nos de 10, 48 em toda hora cheia e 49 às 12:00 UTC.
É a primeira hipótese do pico de CPU do banco (MIA-133), item 6 da dívida
técnica (MIA-137).

Agora cada linha começa com `sleep <atraso>;` antes do `curl`. O atraso:

- é **fixo e vem do nome**: `1 + cksum(caminho da rota) % teto`. O `cksum` é o POSIX, e o do busybox
  do Alpine 3.20 (a imagem do agendador) dá o mesmo número do GNU (medido);
- fica **entre 0 e 45 s**, para a chamada nunca sair do próprio minuto;
- **não muda a frequência** de nenhuma rota: o agendamento, o `-m` e a ordem das linhas são os mesmos.

Resultado: o pico cai de 49 chamadas no mesmo segundo para 6, e fora do segundo zero nenhum segundo
junta mais de 4 rotas.

## O teto: por que algumas rotas ficam no segundo zero

O `crond` do busybox **não dispara uma linha enquanto a rodada anterior dela ainda roda** (registra
"process already running" e pula a batida), e o `sleep` conta como rodada. Sem cuidado, o atraso faria
uma rota perder batidas: uma rota de minuto com `-m 25` e atraso 40 terminaria, no pior caso, aos 65 s,
e a batida do minuto seguinte seria pulada.

Por isso o atraso só usa a **folga** entre o fim da chamada no pior caso (o `-m`) e a batida seguinte
àquela em que ela já terminava:

```
folga = arredonda_para_cima(-m / intervalo) * intervalo - (-m),  no máximo 45
atraso = 0 se a folga é 0;  senão 1 + cksum % folga
```

Assim a chamada que estoura o `-m` termina na mesma batida em que já terminava, e nenhuma rota perde
batida por causa do atraso. O intervalo sai do campo de minuto: `*` é 60 s, `*/N` é N minutos, e
minuto fixo conta como uma hora (o menor intervalo possível; com os `-m` de hoje, no máximo 240 s, o
teto fica em 45 s).

### As rotas cujo `-m` já alcançava a batida seguinte

São todas de minuto. Nenhuma de 5 em 5 ou mais lenta chega perto (a maior é `leads-da-meta`, `-m 240`
a cada 300 s).

| rota | cadência | `-m` | hoje | atraso |
|---|---|---|---|---|
| `prospecting` | minuto | 240 | já passava: no pior caso pula 3 batidas | 0 (folga 0) |
| `agenda-google-sync` | minuto | 90 | já passava: no pior caso pula 1 batida | 15 (folga 30) |
| `ia-pendente` | minuto | 60 | encostava (termina no segundo em que a próxima dispara) | 0 |
| `broadcast-worker` | minuto | 60 | encostava | 0 |
| `email-marketing` | minuto | 60 | encostava | 0 |
| `historico-import` | minuto | 60 | encostava | 0 |
| `raio-x` | minuto | 60 | encostava | 0 |

As seis com atraso 0 são as que ficam juntas no segundo zero. Para tirá-las de lá seria preciso baixar
o `-m` delas, o que muda quanto tempo a chamada pode levar e fica para outra tarefa, depois de medir.

## Onde mora

- `docker/scheduler/entrypoint.sh`: um bloco `FORK MIA (MIA-341)` dentro do laço que escreve o
  crontab, logo antes do `printf` da linha. O atraso entra no fim da variável `quando`, e o `printf`
  continua igual ao do upstream.
- `tests/shell/scheduler-entrypoint.test.sh`: um dublê de `sleep` (marca `FORK MIA (MIA-341)`), porque
  as provas dele rodam linhas inteiras do crontab.
- `tests/unit/agendador-espalha-as-rotas.test.ts`: roda o entrypoint, lê o crontab gerado e prova que
  toda linha tem atraso entre 0 e 45 s, que a lista, as frequências e os `-m` são os da tabela `CRONS=`,
  que o atraso é o do `cksum` (recalculado no teste, sem shell) e o mesmo a cada geração, que nenhum
  segundo passa de 4 rotas (no zero, só as sem folga) e que nenhum atraso passa da folga.

Sem migration, sem índice, sem MCP: não há função nova para o cliente nem para a implantação, é só o
horário das chamadas dentro do minuto.

## Rota nova

Quem criar uma rota não faz nada a mais: o atraso sai do nome. Se o teste reprovar porque o nome novo
caiu num segundo que já tinha 4 rotas, mude o agendamento ou o `-m` da rota nova. Não escreva o atraso à
mão na tabela.
