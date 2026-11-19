---
impacto: nada_mudou
secao: corrigido
titulo: O saldo do provedor grava a leitura no dia escolhido, e o Uso avisa quando o cliente tem mais de um agente
---

No painel da plataforma, em Uso, a leitura do saldo do provedor lançada com
"Quando" igual a hoje aparecia com a data de ontem. A lançada para amanhã caía
em hoje, mas às 21h, e o "consumido desde então" ficava zerado até essa hora
chegar. Agora a leitura de hoje é gravada no momento do lançamento, a de um dia
passado fica no meio-dia daquele dia, e um dia no futuro é recusado tanto na
tela quanto por quem chama a rota direto.

Na tabela "Uso por tenant", a linha de cada cliente soma o uso de todos os
agentes publicados dele, mas mostrava só o nome de um. Quando há mais de um,
a linha passa a dizer quantos são a mais e que o uso soma todos. O CSV
exportado ganha a coluna `agentes_publicados`.
