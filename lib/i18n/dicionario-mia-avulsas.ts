/**
 * FORK MIA (MIA-372) · as frases nossas que moravam soltas no meio do
 * `lib/i18n/dicionario.ts` do upstream, em espanhol (e, em poucas, inglês).
 *
 * Saíram de lá na MIA-372 sem mudar texto nem chave: cada bloco abaixo é um
 * trecho que estava entre linhas do upstream, na mesma ordem em que aparecia.
 * Quem liga este arquivo ao dicionário é `lib/i18n/dicionario-mia.ts`, e a
 * regra é a dos outros arquivos nossos: se o upstream tiver a mesma chave, a
 * dele prevalece. Frase nossa que TEM de vencer a do upstream mora em
 * `dicionario-mia-sobreposicoes.ts`, não aqui.
 *
 * Frase nova não entra aqui: vai para o `dicionario-mia-<assunto>.ts` da função
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 */
import type { Idioma } from "./idiomas";

type Traducoes = Record<string, Partial<Record<Exclude<Idioma, "pt-BR">, string>>>;

export const DICIONARIO_AVULSO_MIA: Traducoes = {
  "o uso soma todos os agentes": { es: "el uso suma todos los agentes" },
  "A data não pode ser depois de hoje.": { es: "La fecha no puede ser posterior a hoy." },

  // FORK MIA: o aviso de sem saldo na Central do cliente (a chave é da plataforma).
  "O crédito de IA é da plataforma. As respostas saem sozinhas quando ele voltar; se demorar, fale com o suporte.": {
    es: "El crédito de IA es de la plataforma. Las respuestas salen solas cuando vuelva; si tarda, habla con soporte.",
  },

  // FORK MIA: modelo e chave são da plataforma; o que o cliente lê no editor de agente.
  "A inteligência dos agentes desta conta é configurada pela nossa equipe e ainda não está pronta. Fale com o suporte.": {
    es: "La inteligencia de los agentes de esta cuenta la configura nuestro equipo y todavía no está lista. Habla con soporte.",
  },
  // FORK MIA — lib/ai/trava-da-ia.ts: a IA dos agentes é da plataforma no servidor.
  "A inteligência dos agentes desta conta é configurada pela nossa equipe. Fale com o suporte para trocar.": {
    es: "La inteligencia de los agentes de esta cuenta la configura nuestro equipo. Habla con soporte para cambiarla.",
  },
  "Esta instalação não tem chave de IA pronta para esta conta: a inteligência dos agentes é configurada pela nossa equipe. Fale com o suporte.": {
    es: "Esta instalación no tiene una clave de IA lista para esta cuenta: la inteligencia de los agentes la configura nuestro equipo. Habla con soporte.",
  },

  // ---- custo das mensagens da Meta ----
  "Não consegui carregar o custo agora.": { es: "No pude cargar el costo ahora." },
  "Custo das mensagens (Meta)": { es: "Costo de los mensajes (Meta)" },
  "A Meta informa a categoria de cada mensagem cobrada, e não o valor — ela cobra por tabela. O dinheiro abaixo é a contagem multiplicada pelos preços que você cadastrar.": { es: "Meta informa la categoría de cada mensaje cobrado, y no el valor — cobra por tabla. El dinero de abajo es el conteo multiplicado por los precios que registres." },
  "Preço por categoria": { es: "Precio por categoría" },
  "Salvar preços": { es: "Guardar precios" },
  "Em reais por mensagem. A tabela vigente da Meta muda por país e por reajuste.": { es: "En reales por mensaje. La tabla vigente de Meta cambia por país y por reajuste." },
  "Gasto em": { es: "Gasto en" },
  "A leitura foi cortada — há mais mensagens no mês do que cabe nesta conta.": { es: "La lectura fue cortada — hay más mensajes en el mes de los que caben en esta cuenta." },
  "Nenhuma mensagem cobrada neste mês.": { es: "Ningún mensaje cobrado este mes." },
  "sem preço cadastrado": { es: "sin precio registrado" },
  "O total está incompleto: falta cadastrar o preço de": { es: "El total está incompleto: falta registrar el precio de" },
  "Custo das mensagens": { es: "Costo de los mensajes" },

  // ---- segmentar campanha por etapa do funil ----
  "Todos os contatos": { es: "Todos los contactos" },

  // ---- editar e excluir template na Meta ----
  "Este template está aprovado. Ao editar, ele volta para análise da Meta e não pode ser disparado até ser aprovado de novo.": { es: "Esta plantilla está aprobada. Al editarla, vuelve al análisis de Meta y no puede dispararse hasta ser aprobada de nuevo." },
  "As variáveis continuam sendo {{1}}, {{2}}… Mudar quantas existem faz a Meta pedir exemplos novos.": { es: "Las variables siguen siendo {{1}}, {{2}}… Cambiar cuántas existen hace que Meta pida ejemplos nuevos." },
  "Salvar na Meta": { es: "Guardar en Meta" },
  "Editar o texto": { es: "Editar el texto" },

  // ---- tela da campanha: os estados do destinatário ----
  "Não consegui carregar a campanha agora.": { es: "No pude cargar la campaña ahora." },
  "Ver todos": { es: "Ver todos" },
  "Abrir a campanha": { es: "Abrir la campaña" },
  "Cargo": { es: "Cargo" },

  // ---- juntar empresas duplicadas ----
  "Agora escolha a ficha duplicada, que será juntada a esta.": { es: "Ahora elige la ficha duplicada, que será unida a esta." },
  "Juntar as duas? A primeira fica; a segunda vira histórico.": { es: "¿Unir las dos? La primera queda; la segunda pasa a ser histórico." },
  "Juntar com…": { es: "Unir con…" },

  // ---- uso de um cliente, no painel ----
  "Não consegui carregar o uso agora.": { es: "No pude cargar el uso ahora." },
  "Movimento": { es: "Movimiento" },
  "Custo de IA": { es: "Costo de IA" },
  "chamadas": { es: "llamadas" },
  "A leitura foi cortada — o custo real é maior.": { es: "La lectura fue cortada — el costo real es mayor." },
  "cobradas": { es: "cobradas" },

  // ---- equipe do cliente, no painel da plataforma ----
  "Não consegui carregar a equipe agora.": { es: "No pude cargar el equipo ahora." },
  "Ninguém tem acesso a esta conta ainda.": { es: "Nadie tiene acceso a esta cuenta todavía." },
  "Pessoa": { es: "Persona" },
  "nunca entrou": { es: "nunca entró" },
  "convidado": { es: "invitado" },
  "revogado": { es: "revocado" },
  "Esta": { es: "Esta" },
  "Nenhum destinatário neste estado.": { es: "Ningún destinatario en este estado." },
  "Excluir este template na Meta? Todos os idiomas dele serão apagados.": { es: "¿Eliminar esta plantilla en Meta? Todos sus idiomas serán borrados." },
  "Só quem tem negócio ABERTO nesta etapa. Ganhos e perdidos ficam de fora.": { es: "Solo quien tiene negocio ABIERTO en esta etapa. Ganados y perdidos quedan fuera." },

  "anotado pela IA": { es: "anotado por la IA" },
  "Não consegui conferir se havia atendimento parado esperando a janela.": {
    es: "No pude comprobar si había atención detenida esperando la ventana.",
  },
  "Atendimentos que estavam esperando a janela voltaram para a fila:": {
    es: "Atenciones que estaban esperando la ventana volvieron a la cola:",
  },

  // Painel de custo da plataforma: as duas naturezas de gasto e o saldo do provedor.
  "De onde vem o gasto de IA": { es: "De dónde viene el gasto de IA" },
  // Saldo e recarga do provedor de IA (painel da plataforma).
  "Saldo estimado": { es: "Saldo estimado" },
  "registre uma leitura de saldo para começar": { es: "registre una lectura de saldo para empezar" },
  "na cotação registrada": { es: "en la cotización registrada" },
  "conta do provedor": { es: "cuenta del proveedor" },
  "conferida em": { es: "verificada el" },
  "nenhuma leitura registrada": { es: "ninguna lectura registrada" },
  "Consumido desde então": { es: "Consumido desde entonces" },
  "recarregados depois": { es: "recargados después" },
  "medido pelas chamadas do período": { es: "medido por las llamadas del período" },
  "Dura até": { es: "Dura hasta" },
  "sem ritmo medido nos últimos 30 dias": { es: "sin ritmo medido en los últimos 30 días" },
  "dia(s)": { es: "día(s)" },
  "Recarga (crédito que entrou)": { es: "Recarga (crédito que entró)" },
  "Leitura (saldo conferido na conta)": { es: "Lectura (saldo verificado en la cuenta)" },
  "Valor em US$": { es: "Valor en US$" },
  "Quando (opcional)": { es: "Cuándo (opcional)" },
  "cartão da empresa": { es: "tarjeta de la empresa" },
  "Registrando…": { es: "Registrando…" },
  "Não consegui registrar. Tente de novo.": { es: "No pude registrar. Inténtelo de nuevo." },
  "Cotação do dólar": { es: "Cotización del dólar" },
  "Em uso:": { es: "En uso:" },
  "Sem cotação: os valores aparecem em dólar.": { es: "Sin cotización: los valores aparecen en dólar." },
  "Nenhum lançamento ainda. Comece registrando uma leitura: o saldo que está hoje na conta do provedor.": { es: "Ningún movimiento todavía. Empiece registrando una lectura: el saldo que hay hoy en la cuenta del proveedor." },
  "Data": { es: "Fecha" },
  "Observação": { es: "Observación" },
  "recarga": { es: "recarga" },
  "leitura": { es: "lectura" },
  "Saldo e recarga do provedor": { es: "Saldo y recarga del proveedor" },
  "O saldo se atualiza sozinho: cai conforme os agentes trabalham e sobe quando você registra uma recarga. Registre uma leitura sempre que conferir a conta do provedor — ela corrige qualquer diferença acumulada.": { es: "El saldo se actualiza solo: baja conforme los agentes trabajan y sube cuando usted registra una recarga. Registre una lectura siempre que verifique la cuenta del proveedor — ella corrige cualquier diferencia acumulada." },
  "Não consegui ler o saldo agora.": { es: "No pude leer el saldo ahora." },
  "Convertido a": { es: "Convertido a" },
  "cotação de": { es: "cotización de" },
  "Sem cotação registrada: valores em dólar.": {
    es: "Sin cotización registrada: valores en dólar.",
  },
  "do total · o que o cliente causou": { es: "del total · lo que el cliente causó" },
  "Operação do sistema": { es: "Operación del sistema" },
  "avaliação do agente, ensaios e indexação": {
    es: "evaluación del agente, ensayos e indexación",
  },
  "Por conversa": { es: "Por conversación" },
  "Total": { es: "Total" },
  "No período:": { es: "En el período:" },
  "Metas do mês": { es: "Metas del mes" },
  "Tipo de receita": { es: "Tipo de ingreso" },
  "Não classificado": { es: "Sin clasificar" },
  "Recorrente (mensalidade)": { es: "Recurrente (mensualidad)" },
  "Avulso (projeto, setup)": { es: "Puntual (proyecto, setup)" },
  "Meses de contrato": { es: "Meses de contrato" },
  "Originado por (SDR)": { es: "Originado por (SDR)" },
  "Fora da equipe atual": { es: "Fuera del equipo actual" },
  "O quanto já foi feito sai do próprio funil e da agenda — não é digitado.": { es: "Lo que ya se hizo sale del propio embudo y de la agenda — no se escribe a mano." },
  "Não consegui carregar as metas agora.": { es: "No pude cargar las metas ahora." },
  "Nenhuma meta definida para este mês. Quem define é quem gerencia, e o acompanhamento aparece aqui na hora.": { es: "Ninguna meta definida para este mes. Quien la define es quien gestiona, y el seguimiento aparece aquí al instante." },
  "Reuniões marcadas": { es: "Reuniones agendadas" },
  "Receita total": { es: "Ingresos totales" },
  "Receita recorrente": { es: "Ingresos recurrentes" },
  "Receita avulsa": { es: "Ingresos puntuales" },
  "Receita originada": { es: "Ingresos originados" },
  "faltam": { es: "faltan" },
  "meta batida": { es: "meta alcanzada" },
  "Recorrente": { es: "Recurrente" },
  "em contrato": { es: "en contrato" },
  "venda(s) ganhas sem natureza declarada: elas entram no total, mas não em recorrente nem em avulso.": { es: "venta(s) ganadas sin naturaleza declarada: entran en el total, pero no en recurrente ni en puntual." },
  "Período inválido: use AAAA-MM.": { es: "Período inválido: use AAAA-MM." },
  "Meta inválida.": { es: "Meta inválida." },
  "Meta de reuniões precisa de uma quantidade.": { es: "La meta de reuniones necesita una cantidad." },
  "Meta de receita precisa de um valor.": { es: "La meta de ingresos necesita un valor." },
  "A meta é de uma pessoa OU de um agente, não dos dois.": { es: "La meta es de una persona O de un agente, no de ambos." },
  "Não consegui gravar a meta.": { es: "No pude guardar la meta." },
  "A OpenAI cobrou": { es: "La OpenAI cobró" },
  "nos": { es: "en los" },
  "dia(s) já fechados": { es: "día(s) ya cerrados" },
  "medimos": { es: "medimos" },
  "diferença de": { es: "diferencia de" },
  "MIA CRM": { es: "MIA CRM" },
  "A chave do provedor de IA é administrada pela plataforma.": {
    es: "La clave del proveedor de IA es administrada por la plataforma.",
  },
  "Agente MIA": { es: "Agente MIA" },
  // FORK MIA (cliente modelo, 9010): o selo da empresa de demonstração.
  "Dados fictícios. Nenhuma mensagem, e-mail ou aviso sai desta empresa.": {
    es: "Datos ficticios. Ningún mensaje, correo o aviso sale de esta empresa.",
  },
  "MIA Insights": { es: "MIA Insights" },
  "Ver tudo no CRM": { es: "Ver todo en el CRM" },
  "Ver tudo no agente": { es: "Ver todo en el agente" },
  "Ver tudo no Insights": { es: "Ver todo en Insights" },
  "Alertas MiaZap": { es: "Alertas MiaZap" },
  "Sessões MiaZap": { es: "Sesiones MiaZap" },
  "pela cotação de cada dia": { es: "por la cotización de cada día" },
  "pelo dólar que você pagou": { es: "por el dólar que usted pagó" },
  "informe o valor em reais das recargas para ver o custo com IOF": { es: "informe el valor en reales de las recargas para ver el costo con IOF" },
  "dia(s) sem cotação, total parcial": { es: "día(s) sin cotización, total parcial" },
  "Quanto saiu em R$ (opcional)": { es: "Cuánto salió en R$ (opcional)" },
  "conversa(s) com gasto": { es: "conversación(es) con gasto" },
  "nenhuma conversa no período": { es: "ninguna conversación en el período" },
  "atendimento + operação": { es: "atención + operación" },
  "chamada(s) do período ainda sem preço conhecido — o modelo não está na tabela de preços, então o total acima é um piso, não a conta fechada.": {
    es: "llamada(s) del período aún sin precio conocido — el modelo no está en la tabla de precios, así que el total de arriba es un piso, no la cuenta cerrada.",
  },

  "Ciclo de venda": { es: "Ciclo de venta" },
  "Evolução": { es: "Evolución" },
  "Nenhuma perda registrada no mês.": { es: "Ninguna pérdida registrada en el mes." },
  "Nenhuma venda no mês.": { es: "Ninguna venta en el mes." },
  "Não consegui carregar o relatório agora.": { es: "No pude cargar el informe ahora." },
  "O que aconteceu no mês: o que fechou, o que se perdeu e por quê.": { es: "Lo que pasó en el mes: lo que se cerró, lo que se perdió y por qué." },
  "Por que perdemos": { es: "Por qué perdimos" },
  "Receita do mês": { es: "Ingreso del mes" },
  "Relatório de vendas": { es: "Informe de ventas" },
  "média": { es: "promedio" },
  "vendas": { es: "ventas" },
  "O cliente pediu": { es: "El cliente lo pidió" },
  "Não respondeu": { es: "No respondió" },
  "Não temos o que ele queria": { es: "No tenemos lo que él quería" },
  "Cancelado por nós": { es: "Cancelado por nosotros" },
  "Pagamento falhou": { es: "El pago falló" },
  "A Meta cobra": { es: "Meta cobra" },
  "A tarifa da Meta não está cadastrada — sem ela não dá para saber se este preço dá lucro.": { es: "La tarifa de Meta no está registrada — sin ella no se puede saber si este precio da ganancia." },
  "este preço está ABAIXO do custo.": { es: "este precio está POR DEBAJO del costo." },
  "margem de": { es: "margen de" },
  // FORK MIA (.58): o Broadcast unificado — número oficial e número por QR (docs/fork/broadcast-unificado.md).
  "O Broadcast não está contratado para esta empresa. Fale com quem cuida da sua conta.": { es: "El Broadcast no está contratado para esta empresa. Habla con quien administra tu cuenta." },
  "O Broadcast não está contratado para esta empresa.": { es: "El Broadcast no está contratado para esta empresa." },
  "Número oficial (Meta)": { es: "Número oficial (Meta)" },
  "Número por QR": { es: "Número por QR" },
  "Sem preço gravado neste disparo.": { es: "Sin precio registrado en este envío." },
  "O disparo parou antes do fim.": { es: "El envío se detuvo antes de terminar." },
  "Sem custo por mensagem, no ritmo do número.": { es: "Sin costo por mensaje, al ritmo del número." },
  "O WhatsApp pode bloquear o número se a lista reclamar.": { es: "WhatsApp puede bloquear el número si la lista reclama." },
  "A lista está montada e nada foi enviado ainda.": { es: "La lista está armada y todavía no se envió nada." },
  "Sem filtro, entram todos os contatos com telefone. Você confere a lista antes de disparar.": { es: "Sin filtro, entran todos los contactos con teléfono. Revisas la lista antes de enviar." },
  "O custo total aparece na conferência, antes de disparar: preço por mensagem vezes quem entrou na lista.": { es: "El costo total aparece en la revisión, antes de enviar: precio por mensaje por quienes entraron en la lista." },
  "Fale com uma lista de contatos que você escolhe e acompanhe quem recebeu.": { es: "Habla con una lista de contactos que eliges y sigue quién recibió." },
  "Novo disparo": { es: "Nuevo envío" },
  "Só modelo aprovado pela Meta. Cada mensagem é cobrada do seu crédito.": { es: "Solo plantilla aprobada por Meta. Cada mensaje se cobra de tu crédito." },
  "Não contratado para esta empresa. Fale com quem cuida da sua conta.": { es: "No contratado para esta empresa. Habla con quien administra tu cuenta." },
  "Texto livre, sem custo por mensagem, no ritmo do número.": { es: "Texto libre, sin costo por mensaje, al ritmo del número." },
  "Risco de bloqueio: o WhatsApp pode bloquear o número se a lista reclamar.": { es: "Riesgo de bloqueo: WhatsApp puede bloquear el número si la lista reclama." },
  "Não consegui carregar os disparos pelo número por QR.": { es: "No pude cargar los envíos por el número por QR." },
  "Não consegui carregar os disparos pelo número oficial.": { es: "No pude cargar los envíos por el número oficial." },
  "Nenhum disparo com este filtro.": { es: "Ningún envío con este filtro." },
  "Nenhum disparo ainda.": { es: "Ningún envío todavía." },
  "Um disparo fala com uma lista de contatos que você escolhe: pelo número oficial, com custo por mensagem, ou pelo número por QR, no ritmo do número.": { es: "Un envío habla con una lista de contactos que eliges: por el número oficial, con costo por mensaje, o por el número por QR, al ritmo del número." },
  "Oficial": { es: "Oficial" },
  "QR": { es: "QR" },
  "Primeiro, por onde a mensagem sai. Nada é enviado antes de você conferir a lista.": { es: "Primero, por dónde sale el mensaje. No se envía nada antes de que revises la lista." },
  "Por onde sai": { es: "Por dónde sale" },
  "Só modelo aprovado pela Meta, com o nome de cada contato.": { es: "Solo plantilla aprobada por Meta, con el nombre de cada contacto." },
  "Sem risco de bloqueio por volume: quem limita é a Meta.": { es: "Sin riesgo de bloqueo por volumen: quien limita es Meta." },
  "Custo: sem preço por mensagem acordado ainda — o disparo recusa até alguém definir.": { es: "Costo: todavía no hay precio por mensaje acordado — el envío se rechaza hasta que alguien lo defina." },
  "Custo:": { es: "Costo:" },
  "por mensagem, do seu crédito": { es: "por mensaje, de tu crédito" },
  "saldo": { es: "saldo" },
  "Usar o número oficial": { es: "Usar el número oficial" },
  "Texto livre, com o nome e os dados de cada contato.": { es: "Texto libre, con el nombre y los datos de cada contacto." },
  "Sem custo por mensagem.": { es: "Sin costo por mensaje." },
  "Sai no ritmo do número: intervalo, teto por hora e por dia.": { es: "Sale al ritmo del número: intervalo, tope por hora y por día." },
  "Risco de bloqueio: se muita gente denunciar, ou se o ritmo passar do que o número aguenta, o WhatsApp pode bloquear o número — e ele leva semanas para voltar.": { es: "Riesgo de bloqueo: si mucha gente denuncia, o si el ritmo supera lo que el número aguanta, WhatsApp puede bloquear el número — y tarda semanas en volver." },
  "Nenhum número por QR conectado. Conecte um em Conexões.": { es: "Ningún número por QR conectado. Conecta uno en Conexiones." },
  "No formulário, escolha um destes números:": { es: "En el formulario, elige uno de estos números:" },
  "Usar o número por QR": { es: "Usar el número por QR" },
  "Montando a lista": { es: "Armando la lista" },
  "Pronta para iniciar": { es: "Lista para iniciar" },
  "Campanhas para uma lista de contatos: pelo número oficial, com custo por mensagem, ou pelo número por QR, no ritmo do número.": { es: "Campañas para una lista de contactos: por el número oficial, con costo por mensaje, o por el número por QR, al ritmo del número." },
  "Enviar para uma lista pela API oficial, com template aprovado e cobrança por mensagem.": { es: "Enviar a una lista por la API oficial, con plantilla aprobada y cobro por mensaje." },
  "Campanhas": { es: "Campañas" },
  "Confira antes de disparar": { es: "Revisa antes de enviar" },
  "Custo estimado:": { es: "Costo estimado:" },
  "Disparando…": { es: "Enviando…" },
  "Disparo começou. O envio acontece em segundo plano.": { es: "El envío comenzó. Ocurre en segundo plano." },
  "Disparo retomado.": { es: "Envío retomado." },
  "Dê um nome e escolha um template aprovado.": { es: "Ponle un nombre y elige una plantilla aprobada." },
  "Enviar para uma lista pela API oficial da Meta, com template aprovado e cobrança por mensagem.": { es: "Enviar a una lista por la API oficial de Meta, con plantilla aprobada y cobro por mensaje." },
  "Escolha…": { es: "Elige…" },
  "Ficaram de fora:": { es: "Quedaron fuera:" },
  "Filtrar por tags (opcional)": { es: "Filtrar por etiquetas (opcional)" },
  "Montando…": { es: "Armando…" },
  "Montar lista": { es: "Armar lista" },
  "Nenhum template aprovado ainda — crie um em Conexões › Templates da Meta.": { es: "Ninguna plantilla aprobada todavía — crea una en Conexiones › Plantillas de Meta." },
  "Nenhuma campanha ainda.": { es: "Ninguna campaña todavía." },
  // "Nome da campanha", "Nova campanha" e "Enviando" também são usadas por esta
  // tela, mas moram no bloco de campanhas do UPSTREAM, com a mesma tradução.
  // Repetir aqui reprova o tsc (TS1117), e tirar de lá faria o bloco dele
  // conflitar em toda sincronização — foi o que aconteceu na fusão da v1.60.0.
  "Não consegui disparar.": { es: "No pude enviar." },
  "Não consegui montar a campanha.": { es: "No pude armar la campaña." },
  "Não consegui retomar.": { es: "No pude retomar." },
  "Retomada setembro": { es: "Retomada septiembre" },
  "Saldo:": { es: "Saldo:" },
  "Sem preço por mensagem acordado — fale com quem cuida da sua conta antes de montar.": { es: "Sin precio por mensaje acordado — habla con quien cuida tu cuenta antes de armar." },
  "Template aprovado": { es: "Plantilla aprobada" },
  "Vazio = todos os contatos com telefone.": { es: "Vacío = todos los contactos con teléfono." },
  "destinatários": { es: "destinatarios" },
  "entregues": { es: "entregados" },
  "enviadas": { es: "enviadas" },
  "pediram para sair": { es: "pidieron salir" },
  "contatos pessoais": { es: "contactos personales" },
  "repetidos": { es: "repetidos" },
  // "sem telefone" mora no bloco do upstream (1.71), com a mesma tradução.
  "Ainda não há preço por mensagem acordado para esta empresa.": { es: "Todavía no hay precio por mensaje acordado para esta empresa." },
  "O crédito não cobre a lista inteira.": { es: "El crédito no cubre la lista completa." },
  "Este template ainda não foi aprovado pela Meta.": { es: "Esta plantilla aún no fue aprobada por Meta." },
  "Nenhum número oficial conectado.": { es: "Ningún número oficial conectado." },
  "O número está com qualidade baixa na Meta — disparar agora acelera o bloqueio.": { es: "El número tiene calidad baja en Meta — enviar ahora acelera el bloqueo." },
  "Nenhum contato entrou na lista.": { es: "Ningún contacto entró en la lista." },
  "O crédito acabou no meio do disparo.": { es: "El crédito se acabó en medio del envío." },
  "Não dá para disparar ainda.": { es: "Todavía no se puede enviar." },
  "A Meta analisa antes de liberar — costuma levar de minutos a algumas horas. Você acompanha o estado nesta mesma tela.": { es: "Meta revisa antes de liberar — suele tardar de minutos a algunas horas. Puedes seguir el estado en esta misma pantalla." },
  "A Meta exige um exemplo por variável para analisar — e recusa sem dizer qual faltou.": { es: "Meta exige un ejemplo por variable para revisar — y rechaza sin decir cuál faltó." },
  "Cada variável precisa de um exemplo — a Meta recusa sem eles.": { es: "Cada variable necesita un ejemplo — Meta rechaza sin ellos." },
  "Enviar para análise": { es: "Enviar a revisión" },
  "Exemplo de cada variável": { es: "Ejemplo de cada variable" },
  "Não consegui criar o template.": { es: "No pude crear la plantilla." },
  "O nome só aceita letras minúsculas, números e _.": { es: "El nombre solo acepta minúsculas, números y _." },
  "Olá, {{1}}! Aqui é {{2}}, da {{3}}.": { es: "¡Hola, {{1}}! Aquí es {{2}}, de {{3}}." },
  "Preencha o nome e o texto.": { es: "Completa el nombre y el texto." },
  "Rodapé (opcional)": { es: "Pie de página (opcional)" },
  "Só letras minúsculas, números e _ — sem espaço e sem acento.": { es: "Solo minúsculas, números y _ — sin espacio y sin acento." },
  "Só letras minúsculas, números e _. É o identificador, não aparece para o cliente.": { es: "Solo minúsculas, números y _. Es el identificador, no aparece para el cliente." },
  "Template enviado para análise da Meta.": { es: "Plantilla enviada a revisión de Meta." },
  "Time Company": { es: "Time Company" },
  "Use {{1}}, {{2}} onde o texto muda por pessoa.": { es: "Usa {{1}}, {{2}} donde el texto cambia por persona." },
  "aqui mesmo — a Meta analisa e o estado aparece nesta tela. Só template aprovado pode ser enviado fora da janela de 24 horas.": { es: "aquí mismo — Meta revisa y el estado aparece en esta pantalla. Solo plantilla aprobada puede enviarse fuera de la ventana de 24 horas." },
  "É o que mais ajuda na aprovação e o que segura bloqueio: quem consegue sair sozinho não denuncia.": { es: "Es lo que más ayuda en la aprobación y lo que frena bloqueos: quien puede salir solo no denuncia." },
  "Prospecção, oferta, retomada de conversa.": { es: "Prospección, oferta, retomar conversación." },
  "Confirmação, lembrete, atualização de pedido.": { es: "Confirmación, recordatorio, actualización de pedido." },
  "Incluir botão \"Parar promoções\"": { es: "Incluir botón \"Parar promociones\"" },
  "(agente)": { es: "(agente)" },
  "Alvo (R$)": { es: "Objetivo (R$)" },
  "Alvo (quantidade)": { es: "Objetivo (cantidad)" },
  "Alvo inválido.": { es: "Objetivo inválido." },
  "Da empresa inteira": { es: "De toda la empresa" },
  // "De quem é a meta" vem do bloco do upstream (#4796, meta em valor): as duas eram iguais e o tsc recusa chave repetida.
  "Definir meta": { es: "Definir meta" },
  "Definir meta do mês": { es: "Definir meta del mes" },
  "Informe o alvo.": { es: "Informe el objetivo." },
  "Meta definida.": { es: "Meta definida." },
  "O acompanhamento é derivado do funil e da agenda — você define só o alvo.": { es: "El seguimiento se deriva del embudo y de la agenda — tú defines solo el objetivo." },
  "O que medir": { es: "Qué medir" },
  "Receita originada é a meta de uma PESSOA — escolha quem.": { es: "Ingreso originado es la meta de una PERSONA — elige quién." },
  "Atividade de quem prospecta — o que ele controla.": { es: "Actividad de quien prospecta — lo que él controla." },
  "Comparecimento: das marcadas, quantas aconteceram de verdade.": { es: "Asistencia: de las agendadas, cuántas ocurrieron de verdad." },
  "Tudo que foi ganho nos funis que contam como receita.": { es: "Todo lo ganado en los embudos que cuentan como ingreso." },
  "Só mensalidade e assinatura.": { es: "Solo mensualidad y suscripción." },
  "Só projeto, setup, venda única.": { es: "Solo proyecto, setup, venta única." },
  "A participação do SDR na venda que outro fechou. Exige escolher uma pessoa.": { es: "La participación del SDR en la venta que otro cerró. Exige elegir una persona." },
  "Nenhuma meta definida para este mês. Use \"Definir meta\" acima — o acompanhamento aparece aqui na hora.": { es: "Ninguna meta definida para este mes. Usa \"Definir meta\" arriba — el seguimiento aparece aquí al instante." },
  "Regras do tipo 'quando acontecer X, faça Y' — e a entrada de dados de outros sistemas.": { es: "Reglas del tipo 'cuando pase X, haz Y' — y la entrada de datos de otros sistemas." },
  "Comparecimento": { es: "Asistencia" },
  "Das reuniões que já aconteceram ou faltaram.": { es: "De las reuniones que ya ocurrieron o se perdieron." },
  "Nenhuma reunião com desfecho ainda.": { es: "Ninguna reunión con desenlace todavía." },
  "faltas": { es: "faltas" },
  "realizadas": { es: "realizadas" },
  "sem desfecho": { es: "sin desenlace" },
  "Reuniões realizadas": { es: "Reuniones realizadas" },
  "Ganhar neste funil é receita": { es: "Ganar en este embudo es ingreso" },
  "Desmarque no funil do SDR, onde ganhar é 'reunião agendada' e o card só passa adiante: somar isso no relatório anuncia faturamento que ainda não entrou.": { es: "Desmarca en el embudo del SDR, donde ganar es 'reunión agendada' y la tarjeta solo pasa adelante: sumar eso en el informe anuncia facturación que todavía no entró." },
  "Liberado em": { es: "Liberado el" },
  "Não consegui carregar os módulos agora.": { es: "No pude cargar los módulos ahora." },
  "O que não está nesta lista continua valendo para todos os clientes — aqui só entra o que se vende separado.": { es: "Lo que no está en esta lista sigue valiendo para todos los clientes — aquí solo entra lo que se vende aparte." },
  "Ainda não há preço por mensagem acordado — fale com quem cuida da sua conta antes de programar um disparo.": { es: "Todavía no hay precio por mensaje acordado — habla con quien cuida tu cuenta antes de programar un envío." },
  "Avisar quando o saldo cair abaixo de (R$)": { es: "Avisar cuando el saldo baje de (R$)" },
  "Creditado": { es: "Acreditado" },
  "Creditar": { es: "Acreditar" },
  "Créditos": { es: "Créditos" },
  "Dá para {n} mensagens, a {preco} cada.": { es: "Alcanza para {n} mensajes, a {preco} cada uno." },
  "Esta tela é de quem gerencia a empresa.": { es: "Esta pantalla es de quien gestiona la empresa." },
  "Estornado": { es: "Reembolsado" },
  "Extrato": { es: "Extracto" },
  "Hoje:": { es: "Hoy:" },
  "Lançar na carteira": { es: "Registrar en la billetera" },
  "Mostrando os lançamentos mais recentes. O saldo acima soma o extrato inteiro.": { es: "Mostrando los movimientos más recientes. El saldo de arriba suma el extracto completo." },
  "Nenhum lançamento ainda.": { es: "Ningún movimiento todavía." },
  "Não consegui carregar a carteira agora.": { es: "No pude cargar la billetera ahora." },
  "Não consegui carregar os créditos agora.": { es: "No pude cargar los créditos ahora." },
  "O crédito deste cliente está abaixo do piso de aviso.": { es: "El crédito de este cliente está por debajo del piso de aviso." },
  "Preço acordado": { es: "Precio acordado" },
  "Preço por mensagem (R$)": { es: "Precio por mensaje (R$)" },
  "Quanto crédito a empresa tem para disparos, e o que já foi consumido.": { es: "Cuánto crédito tiene la empresa para envíos, y lo que ya se consumió." },
  "Saldo": { es: "Saldo" },
  "Saldo do cliente": { es: "Saldo del cliente" },
  "Salvar preço": { es: "Guardar precio" },
  "Sem preço acordado — o disparador RECUSA até alguém definir, em vez de supor.": { es: "Sin precio acordado — el disparador RECHAZA hasta que alguien lo defina, en vez de suponer." },
  "Seu crédito está acabando.": { es: "Tu crédito se está acabando." },
  "ex.: pacote de 5.000 mensagens": { es: "ej.: paquete de 5.000 mensajes" },
  "por mensagem": { es: "por mensaje" },
  "Se o contato já tiver negócio em outro funil": { es: "Si el contacto ya tiene negocio en otro embudo" },
  "Não fazer nada": { es: "No hacer nada" },
  "Abrir um card novo aqui": { es: "Abrir una tarjeta nueva aquí" },
  "O negócio de origem continua onde está — é cópia, não mudança de funil.": { es: "El negocio de origen se queda donde está — es copia, no cambio de embudo." },
  "Quando uma reunião for marcada": { es: "Cuando se agende una reunión" },
  "Avisar o time num grupo do WhatsApp": { es: "Avisar al equipo en un grupo de WhatsApp" },
  "Tipo de compromisso": { es: "Tipo de cita" },
  "Id do grupo": { es: "Id del grupo" },
  "Precisa ser um número conectado por QR Code — a API oficial da Meta não envia para grupo.": { es: "Tiene que ser un número conectado por código QR — la API oficial de Meta no envía a grupos." },
  "Id de grupo termina em @g.us. Um número de pessoa aqui manda o aviso interno para o cliente.": { es: "El id de grupo termina en @g.us. Un número de persona aquí manda el aviso interno al cliente." },
  "O id aparece na conversa do grupo, na tela de Conexões, assim que ele mandar a primeira mensagem para este número.": { es: "El id aparece en la conversación del grupo, en la pantalla de Conexiones, en cuanto él mande el primer mensaje a este número." },
  "Aviso interno: sai na hora, sem esperar a janela de envio nem contar no limite diário do número.": { es: "Aviso interno: sale al instante, sin esperar la ventana de envío ni contar en el límite diario del número." },
  "Reunião marcada com {{contact.display_name}} — {{agendamento.starts_at}}": { es: "Reunión agendada con {{contact.display_name}} — {{agendamento.starts_at}}" },

  "Este canal envia, mas NÃO recebe": { es: "Este canal envía, pero NO recibe" },
  lidas: { es: "leídas" },
  "Imagem do topo (opcional)": { es: "Imagen del encabezado (opcional)" },
  "É só a amostra que a Meta analisa — a imagem de cada campanha você escolhe na hora de disparar. JPG, PNG, MP4 ou PDF, até 5 MB.": { es: "Es solo la muestra que Meta analiza — la imagen de cada campaña se elige al enviar. JPG, PNG, MP4 o PDF, hasta 5 MB." },
  "Não consegui subir o arquivo.": { es: "No pude subir el archivo." },
  "Imagem pronta para a análise da Meta.": { es: "Imagen lista para el análisis de Meta." },
  "Escolha um arquivo.": { es: "Elegí un archivo." },
  "O exemplo precisa ter até 5 MB.": { es: "La muestra puede tener hasta 5 MB." },
  "Envio inválido.": { es: "Envío inválido." },
  "Disparar em": { es: "Enviar el" },
  "Confirmar agendamento": { es: "Confirmar programación" },
  "Campanha agendada.": { es: "Campaña programada." },
  "Não consegui agendar.": { es: "No pude programar." },
  "Sai em": { es: "Sale el" },
  "O crédito e a aprovação do template são conferidos agora E de novo na hora do envio — entre uma coisa e outra, outro disparo pode ter consumido o saldo.": { es: "El crédito y la aprobación de la plantilla se verifican ahora Y de nuevo al enviar — entre una cosa y otra, otro envío puede haber consumido el saldo." },
  "A hora escolhida já passou.": { es: "La hora elegida ya pasó." },
  "Agendamento inválido.": { es: "Programación inválida." },
  "Não consegui ler as tags agora — tente de novo em instantes.": { es: "No pude leer las etiquetas ahora — probá de nuevo en instantes." },
  "Nenhum contato tem tag ainda. A campanha vai para todos os contatos com telefone.": { es: "Ningún contacto tiene etiqueta todavía. La campaña va para todos los contactos con teléfono." },
  "Nada marcado = todos os contatos com telefone.": { es: "Nada marcado = todos los contactos con teléfono." },
  "Quem tiver QUALQUER uma das tags marcadas entra na lista.": { es: "Quien tenga CUALQUIERA de las etiquetas marcadas entra en la lista." },
  "Alguma tag marcada não existe mais nos contatos:": { es: "Alguna etiqueta marcada ya no existe en los contactos:" },
  "Salvar REMONTA a lista de destinatários com o filtro acima — quem estava antes e não passa no filtro novo sai.": { es: "Guardar REARMA la lista de destinatarios con el filtro de arriba — quien estaba antes y no pasa el filtro nuevo sale." },
  "Salvar e remontar": { es: "Guardar y rearmar" },
  "Lista remontada:": { es: "Lista rearmada:" },
  "Campanha atualizada.": { es: "Campaña actualizada." },
  "Ver destinatários": { es: "Ver destinatarios" },
  "Ocultar destinatários": { es: "Ocultar destinatarios" },
  "Nenhum destinatário na lista.": { es: "Ningún destinatario en la lista." },
  "(sem cadastro)": { es: "(sin registro)" },
  "Mostrando os primeiros": { es: "Mostrando los primeros" },
  "Nome atualizado.": { es: "Nombre actualizado." },
  "Não consegui renomear.": { es: "No pude renombrar." },
  "Rascunho excluído.": { es: "Borrador eliminado." },
  "Não consegui excluir.": { es: "No pude eliminar." },
  "Disparo iniciado.": { es: "Envío iniciado." },
  "Este template pede mais informação": { es: "Esta plantilla pide más información" },
  "A variável {{1}} é preenchida com o nome de cada contato. As de baixo são iguais para a lista toda.": { es: "La variable {{1}} se completa con el nombre de cada contacto. Las de abajo son iguales para toda la lista." },
  "o mesmo texto para todos": { es: "el mismo texto para todos" },
  "Preencha as variáveis do template:": { es: "Completá las variables de la plantilla:" },
  entregue: { es: "entregada" },
  lida: { es: "leída" },
  devolvidas: { es: "devueltas" },
  "Falta segredo no servidor. A Meta vai entregar as respostas e o sistema vai recusar todas, sem erro visível: o cliente responde e a mensagem não aparece em lugar nenhum.":
    {
      es: "Falta un secreto en el servidor. Meta va a entregar las respuestas y el sistema las va a rechazar todas, sin error visible: el cliente responde y el mensaje no aparece en ninguna parte.",
    },
  "Defina no .env do servidor e reinicie o app.":
    { es: "Definilo en el .env del servidor y reiniciá la app." },

  // FORK MIA: o corpo do teto do plano do fork (`CORPO_TETO_DO_PLANO`,
  // lib/agent-engine/edge/llm/orcamento.ts), sem "cadastre uma chave de IA própria".
  "O uso de IA incluído no plano acabou neste mês. As conversas foram para a equipe. Troque de plano em Configurações › Plano e cobrança ou aguarde o próximo mês.": { es: "El uso de IA incluido en el plan se agotó este mes. Las conversaciones pasaron al equipo. Cambia de plan en Configuración › Plan y facturación o espera al próximo mes." },

  // FORK MIA: o mesmo rascunho sem cérebro, dito ao CLIENTE (a chave é da plataforma).
  "A inteligência dele é configurada pela nossa equipe e ainda não está pronta nesta conta. Pode seguir com a configuração; se ele não entrar no ar, fale com o suporte.": {
    es: "Su inteligencia la configura nuestro equipo y todavía no está lista en esta cuenta. Puedes seguir con la configuración; si no entra en funcionamiento, habla con soporte.",
  },

  // FORK MIA (lib/onboarding/pacotes-da-mia.ts)
  "Indústria ou distribuidora que vende para revendas": { es: "Industria o distribuidora que vende a revendedores" },

  // FORK MIA: o mesmo aviso com os nomes do menu da MIA.
  "Para usar um motivo que não está aqui, cadastre em MIA CRM › Ver tudo no CRM › Etapas do funil.": {
    es: "Para usar un motivo que no está aquí, agrégalo en MIA CRM › Ver todo en el CRM › Etapas del embudo.",
  },

  // Do Mês e da Semana para o Dia (`GradeDaAgenda`, `rotuloDeAbrirODia`).
  "Abrir o dia {dia}": { es: "Abrir el día {dia}" },
  "Abrir o dia {dia}, 1 compromisso": { es: "Abrir el día {dia}, 1 cita" },
  "Abrir o dia {dia}, {n} compromissos": { es: "Abrir el día {dia}, {n} citas" },
  "Abrir o dia {dia}, mais 1 compromisso": { es: "Abrir el día {dia}, 1 cita más" },
  "Abrir o dia {dia}, mais {n} compromissos": { es: "Abrir el día {dia}, {n} citas más" },

  // FORK MIA: o crédito de IA é da plataforma (corpo do aviso de sem saldo).
  "As respostas aos clientes estão esperando o crédito de IA da plataforma voltar: elas saem sozinhas quando ele voltar, durante até 6 horas. Se demorar, fale com o suporte. Depois disso, a conversa que não foi respondida aparece aqui na Central.": {
    es: "Las respuestas a los clientes están esperando que vuelva el crédito de IA de la plataforma: salen solas cuando vuelva, durante hasta 6 horas. Si tarda, habla con soporte. Después de eso, la conversación que no se respondió aparece aquí en la Central.",
  },

  // FORK MIA: o crédito de IA é da plataforma (push do aviso de sem saldo).
  "As respostas estão esperando o crédito de IA da plataforma voltar e saem sozinhas quando ele voltar. Se demorar, fale com o suporte.": {
    es: "Las respuestas están esperando que vuelva el crédito de IA de la plataforma y salen solas cuando vuelva. Si tarda, habla con soporte.",
  },

  // FORK MIA (.60) — Configurações › Formulários da Meta (docs/fork/leads-da-meta.md).
  "Formulários da Meta": { es: "Formularios de Meta" },
  "Importar os leads dos anúncios de cadastro instantâneo para o funil.": { es: "Importar los leads de los anuncios de registro instantáneo al embudo." },
  "Os leads dos anúncios de cadastro instantâneo (o formulário que abre dentro do Facebook e do Instagram) entram sozinhos no funil, a cada 5 minutos, com a origem do anúncio e as respostas do formulário. As automações de lead criado disparam como em qualquer captação.": { es: "Los leads de los anuncios de registro instantáneo (el formulario que se abre dentro de Facebook e Instagram) entran solos al embudo, cada 5 minutos, con el origen del anuncio y las respuestas del formulario. Las automatizaciones de lead creado se disparan como en cualquier captación." },
  "Não consegui carregar agora.": { es: "No pude cargar ahora." },
  "Nenhum token de anúncios conectado.": { es: "No hay ningún token de anuncios conectado." },
  "Os leads são lidos com o mesmo token da tabela de campanhas. Cole em Configurações › Meta Ads um token com as permissões leads_retrieval, pages_show_list, pages_read_engagement e pages_manage_ads.": { es: "Los leads se leen con el mismo token de la tabla de campañas. Pega en Configuración › Meta Ads un token con los permisos leads_retrieval, pages_show_list, pages_read_engagement y pages_manage_ads." },
  "Ir para Configurações › Meta Ads": { es: "Ir a Configuración › Meta Ads" },
  "Importação": { es: "Importación" },
  "Importar os leads dos formulários": { es: "Importar los leads de los formularios" },
  "ligada em": { es: "activada el" },
  "A importação está ligada, mas nenhum formulário foi escolhido. Escolha abaixo quais importar.": { es: "La importación está activada, pero no se eligió ningún formulario. Elige abajo cuáles importar." },
  "Dias para trás na primeira leitura (0 a 90)": { es: "Días hacia atrás en la primera lectura (0 a 90)" },
  "Lendo…": { es: "Leyendo…" },
  "Ler agora": { es: "Leer ahora" },
  "A leitura automática roda a cada 5 minutos. A primeira leitura de cada formulário volta os dias escolhidos acima; a Meta guarda os leads por 90 dias.": { es: "La lectura automática se ejecuta cada 5 minutos. La primera lectura de cada formulario vuelve los días elegidos arriba; Meta guarda los leads durante 90 días." },
  "Leitura concluída": { es: "Lectura concluida" },
  "Permissões do token": { es: "Permisos del token" },
  "Conferir de novo": { es: "Verificar de nuevo" },
  "A Meta não informou as permissões deste token. A leitura dos formulários abaixo mostra se ele alcança os leads.": { es: "Meta no informó los permisos de este token. La lectura de los formularios de abajo muestra si alcanza los leads." },
  "O token tem as permissões para ler os leads.": { es: "El token tiene los permisos para leer los leads." },
  "Faltam permissões no token, e sem elas nenhum lead é lido:": { es: "Faltan permisos en el token y, sin ellos, no se lee ningún lead:" },
  "Recomendadas, e ainda não concedidas:": { es: "Recomendados y aún no concedidos:" },
  "Para resolver: Gerenciador de Negócios › Configurações do negócio › Usuários do sistema › o usuário do token › Gerar novo token. Marque as permissões que faltam e cole o token novo em Configurações › Meta Ads.": { es: "Para resolverlo: Administrador comercial › Configuración del negocio › Usuarios del sistema › el usuario del token › Generar nuevo token. Marca los permisos que faltan y pega el token nuevo en Configuración › Meta Ads." },
  "Páginas e formulários": { es: "Páginas y formularios" },
  "Lendo as Páginas na Meta…": { es: "Leyendo las Páginas en Meta…" },
  "O token não alcança nenhuma Página. No Gerenciador de Negócios, atribua a Página ao usuário do sistema do token (Usuários do sistema › Atribuir ativos › Páginas).": { es: "El token no alcanza ninguna Página. En el Administrador comercial, asigna la Página al usuario del sistema del token (Usuarios del sistema › Asignar activos › Páginas)." },
  "O token alcança mais Páginas do que esta tela lista de uma vez; aparecem as 30 primeiras.": { es: "El token alcanza más Páginas de las que esta pantalla lista de una vez; aparecen las 30 primeras." },
  "Formulários escolhidos que o token não alcança mais:": { es: "Formularios elegidos que el token ya no alcanza:" },
  "Esta Página não tem formulários de cadastro.": { es: "Esta Página no tiene formularios de registro." },
  "Arquivado na Meta": { es: "Archivado en Meta" },
  "Ativo na Meta": { es: "Activo en Meta" },
  "Ainda não lido": { es: "Aún no leído" },
  "importados": { es: "importados" },
  "Importar este formulário": { es: "Importar este formulario" },
  "Ligue \"Importar este formulário\", confira o destino e salve.": { es: "Activa \"Importar este formulario\", revisa el destino y guarda." },
  "Histórico de leituras": { es: "Historial de lecturas" },
  "Nenhuma leitura ainda. Com a importação ligada e um formulário escolhido, a primeira acontece em até 5 minutos, ou agora pelo botão Ler agora.": { es: "Aún no hay lecturas. Con la importación activada y un formulario elegido, la primera ocurre en hasta 5 minutos, o ahora con el botón Leer ahora." },
  "Formulário": { es: "Formulario" },
  "O que aconteceu": { es: "Qué pasó" },
  "leituras seguidas desde": { es: "lecturas seguidas desde" },
  "Sem leads novos": { es: "Sin leads nuevos" },
  "Você não tem acesso a esta configuração.": { es: "No tienes acceso a esta configuración." },
  "Nenhum token de anúncios conectado. Cole o token em Configurações › Meta Ads.": { es: "No hay ningún token de anuncios conectado. Pega el token en Configuración › Meta Ads." },
  "A chave de criptografia do servidor não está disponível para ler o token. É configuração do servidor.": { es: "La clave de cifrado del servidor no está disponible para leer el token. Es configuración del servidor." },
  "A Meta recusou o token: ele expirou ou foi revogado. Gere um novo no Gerenciador de Negócios e cole em Configurações › Meta Ads.": { es: "Meta rechazó el token: expiró o fue revocado. Genera uno nuevo en el Administrador comercial y pégalo en Configuración › Meta Ads." },
  "O token não tem permissão para ler os leads deste formulário. Confira as permissões acima e, no Gerenciador de Negócios, o Acesso a leads da Página.": { es: "El token no tiene permiso para leer los leads de este formulario. Revisa los permisos de arriba y, en el Administrador comercial, el Acceso a leads de la Página." },
  "A Meta limitou as chamadas por excesso de consultas. A próxima leitura tenta de novo sozinha.": { es: "Meta limitó las llamadas por exceso de consultas. La próxima lectura lo intenta de nuevo sola." },
  "A Meta recusou um campo da consulta. É problema do sistema, não da sua conta: avise quem mantém a instalação.": { es: "Meta rechazó un campo de la consulta. Es un problema del sistema, no de tu cuenta: avisa a quien mantiene la instalación." },
  "Não foi possível falar com a Meta agora. A próxima leitura tenta de novo sozinha.": { es: "No fue posible hablar con Meta ahora. La próxima lectura lo intenta de nuevo sola." },
  "A Página deste formulário não está atribuída ao usuário do sistema do token. Atribua a Página no Gerenciador de Negócios.": { es: "La Página de este formulario no está asignada al usuario del sistema del token. Asigna la Página en el Administrador comercial." },
  "O usuário do sistema não tem acesso suficiente à Página. Dê a ele acesso de anúncios e de leads (ou controle total) no Gerenciador de Negócios.": { es: "El usuario del sistema no tiene acceso suficiente a la Página. Dale acceso de anuncios y de leads (o control total) en el Administrador comercial." },
  "O funil ou a etapa de destino deste formulário não existe mais. Escolha outro destino e salve.": { es: "El embudo o la etapa de destino de este formulario ya no existe. Elige otro destino y guarda." },
  "Chegaram mais leads do que uma leitura comporta e a leitura ficou incompleta. Avise quem mantém a instalação.": { es: "Llegaron más leads de los que caben en una lectura y la lectura quedó incompleta. Avisa a quien mantiene la instalación." },
  "Os leads chegaram, mas a gravação parou no meio. A próxima leitura tenta de novo sozinha.": { es: "Los leads llegaron, pero la grabación se detuvo a la mitad. La próxima lectura lo intenta de nuevo sola." },
  "A Meta não devolveu a origem do anúncio (campanha, conjunto e anúncio) destes leads. Eles entraram mesmo assim. Para ter a origem, gere o token de novo com a permissão ads_management.": { es: "Meta no devolvió el origen del anuncio (campaña, conjunto y anuncio) de estos leads. Entraron de todos modos. Para tener el origen, genera el token de nuevo con el permiso ads_management." },
  "Parte do período pedido tem mais de 90 dias, e a Meta não guarda leads tão antigos.": { es: "Parte del período pedido tiene más de 90 días, y Meta no guarda leads tan antiguos." },
  "ler os leads": { es: "leer los leads" },
  "listar as Páginas": { es: "listar las Páginas" },
  "ler os dados da Página": { es: "leer los datos de la Página" },
  "listar os formulários e ler os leads com os dados do anúncio": { es: "listar los formularios y leer los leads con los datos del anuncio" },
  "trazer a origem do anúncio de cada lead": { es: "traer el origen del anuncio de cada lead" },
  "a tabela de campanhas em Análise › Meta Ads": { es: "la tabla de campañas en Análisis › Meta Ads" },
  // FORK MIA (.61) — os Formulários da Meta viraram aba de Meta Ads, e cada
  // Página da Meta é de uma empresa só (migration 9004, /admin/paginas-da-meta).
  "Seções de Meta Ads": { es: "Secciones de Meta Ads" },
  "Contas de anúncio": { es: "Cuentas publicitarias" },
  "Formulários de leads": { es: "Formularios de leads" },
  "Conectar a conta de anúncios e importar os leads dos formulários de cadastro instantâneo.": {
    es: "Conectar la cuenta publicitaria e importar los leads de los formularios de registro instantáneo.",
  },
  "Nenhuma Página da Meta é desta empresa ainda.": {
    es: "Ninguna Página de Meta es de esta empresa todavía.",
  },
  "Cada Página da Meta é de uma empresa só, e quem define de qual empresa é cada Página é quem administra a plataforma. Peça ao suporte para atribuir a Página desta empresa; depois disso os formulários dela aparecem aqui.":
    {
      es: "Cada Página de Meta es de una sola empresa, y quien define de qué empresa es cada Página es quien administra la plataforma. Pide al soporte que asigne la Página de esta empresa; después sus formularios aparecen aquí.",
    },
  "Os leads são lidos com o mesmo token da tabela de campanhas. Cole na aba Contas de anúncio um token com as permissões leads_retrieval, pages_show_list, pages_read_engagement e pages_manage_ads.":
    {
      es: "Los leads se leen con el mismo token de la tabla de campañas. Pega en la pestaña Cuentas publicitarias un token con los permisos leads_retrieval, pages_show_list, pages_read_engagement y pages_manage_ads.",
    },
  "Ir para Contas de anúncio": { es: "Ir a Cuentas publicitarias" },
  "Estas Páginas são lidas pela conexão da plataforma. Avise o suporte para gerar o token de novo com as permissões que faltam.":
    {
      es: "Estas Páginas se leen con la conexión de la plataforma. Avisa al soporte para que genere el token de nuevo con los permisos que faltan.",
    },
  "Esta empresa tem mais Páginas do que esta tela lista de uma vez; aparecem as 30 primeiras.": {
    es: "Esta empresa tiene más Páginas de las que esta pantalla lista de una vez; aparecen las 30 primeras.",
  },
  "Formulários de Páginas que não são desta empresa:": {
    es: "Formularios de Páginas que no son de esta empresa:",
  },
  "Esta Página não é desta empresa na plataforma, e a importação dos formulários dela foi desligada aqui. Quem administra a plataforma define de qual empresa é cada Página.":
    {
      es: "Esta Página no es de esta empresa en la plataforma, y la importación de sus formularios se desactivó aquí. Quien administra la plataforma define de qué empresa es cada Página.",
    },
  "Páginas da Meta": { es: "Páginas de Meta" },
  "Não consegui carregar as Páginas da Meta agora.": {
    es: "No pude cargar las Páginas de Meta ahora.",
  },
  "Conexão da plataforma": { es: "Conexión de la plataforma" },
  "O token de Meta Ads desta empresa lê as Páginas atribuídas a quem não tem token próprio, e só elas. Normalmente é a empresa da agência.":
    {
      es: "El token de Meta Ads de esta empresa lee las Páginas asignadas a quien no tiene token propio, y solo ellas. Normalmente es la empresa de la agencia.",
    },
  "Empresa que empresta a conexão": { es: "Empresa que presta la conexión" },
  "Nenhuma: cada empresa usa o próprio token": { es: "Ninguna: cada empresa usa su propio token" },
  "Nenhuma empresa tem conexão de Meta Ads. Conecte o token em Configurações › Meta Ads de uma empresa.":
    {
      es: "Ninguna empresa tiene conexión de Meta Ads. Conecta el token en Configuración › Meta Ads de una empresa.",
    },
  "Páginas e donos": { es: "Páginas y dueños" },
  "Escolha a conexão da plataforma acima para ver as Páginas que o token alcança.": {
    es: "Elige la conexión de la plataforma arriba para ver las Páginas que alcanza el token.",
  },
  Atribuídas: { es: "Asignadas" },
  "o token não alcança mais esta Página": { es: "el token ya no alcanza esta Página" },
  "De qual empresa é esta Página": { es: "De qué empresa es esta Página" },
  "De qual empresa é esta Página?": { es: "¿De qué empresa es esta Página?" },
  "Trocar dono": { es: "Cambiar dueño" },
  Atribuir: { es: "Asignar" },
  "Retirar dono": { es: "Quitar dueño" },
  "A empresa escolhida não tem mais conexão de Meta Ads. Conecte o token em Configurações › Meta Ads dela.":
    {
      es: "La empresa elegida ya no tiene conexión de Meta Ads. Conecta el token en su Configuración › Meta Ads.",
    },
  "A Meta recusou o token: ele expirou ou foi revogado. Gere um novo no Gerenciador de Negócios e cole em Configurações › Meta Ads da empresa escolhida.":
    {
      es: "Meta rechazó el token: expiró o fue revocado. Genera uno nuevo en el Administrador comercial y pégalo en Configuración › Meta Ads de la empresa elegida.",
    },
  "O token não tem permissão para listar as Páginas (pages_show_list).": {
    es: "El token no tiene permiso para listar las Páginas (pages_show_list).",
  },
  "A Meta limitou as chamadas por excesso de consultas. Tente de novo em alguns minutos.": {
    es: "Meta limitó las llamadas por exceso de consultas. Inténtalo de nuevo en unos minutos.",
  },
  "Não foi possível falar com a Meta agora. Tente de novo em instantes.": {
    es: "No fue posible comunicarse con Meta ahora. Inténtalo de nuevo en unos instantes.",
  },
  "A Meta recusou um campo da consulta. É problema do sistema, não da conta.": {
    es: "Meta rechazó un campo de la consulta. Es un problema del sistema, no de la cuenta.",
  },
  // FORK MIA (.62) — leads da Meta em tempo real, telefone em pergunta própria e
  // aviso quando a leitura para (docs/fork/leads-da-meta.md).
  "Os leads dos anúncios de cadastro instantâneo (o formulário que abre dentro do Facebook e do Instagram) entram sozinhos no funil, em segundos pelo aviso da Meta ou em até 5 minutos pela leitura, com a origem do anúncio e as respostas do formulário. As automações de lead criado disparam como em qualquer captação.":
    {
      es: "Los leads de los anuncios de registro instantáneo (el formulario que se abre dentro de Facebook e Instagram) entran solos al embudo, en segundos por el aviso de Meta o en hasta 5 minutos por la lectura, con el origen del anuncio y las respuestas del formulario. Las automatizaciones de lead creado se disparan como en cualquier captación.",
    },
  "Com o tempo real ligado, a Meta avisa na hora e o lead entra em segundos; a leitura automática a cada 5 minutos continua como garantia. A primeira leitura de cada formulário volta os dias escolhidos acima; a Meta guarda os leads por 90 dias.":
    {
      es: "Con el tiempo real activado, Meta avisa en el momento y el lead entra en segundos; la lectura automática cada 5 minutos sigue como garantía. La primera lectura de cada formulario retrocede los días elegidos arriba; Meta guarda los leads por 90 días.",
    },
  "receber os leads na hora (tempo real)": { es: "recibir los leads en el momento (tiempo real)" },
  "Tempo real ligado: a Meta avisa na hora em que alguém preenche, e o lead entra em segundos. A leitura a cada 5 minutos continua como garantia.":
    {
      es: "Tiempo real activado: Meta avisa en el momento en que alguien completa el formulario, y el lead entra en segundos. La lectura cada 5 minutos sigue como garantía.",
    },
  "Tempo real ainda não conferido. O sistema tenta ligar na próxima leitura; enquanto isso, os leads chegam pela leitura a cada 5 minutos.":
    {
      es: "Tiempo real aún no verificado. El sistema intenta activarlo en la próxima lectura; mientras tanto, los leads llegan por la lectura cada 5 minutos.",
    },
  "Tempo real desligado: a Meta recusou assinar a Página por falta da permissão pages_manage_metadata no token. Os leads continuam chegando pela leitura a cada 5 minutos. Para ligar, gere o token de novo com essa permissão e clique em Ligar o tempo real.":
    {
      es: "Tiempo real desactivado: Meta rechazó suscribir la Página por falta del permiso pages_manage_metadata en el token. Los leads siguen llegando por la lectura cada 5 minutos. Para activarlo, genera el token de nuevo con ese permiso y haz clic en Activar el tiempo real.",
    },
  "Tempo real desligado: a Meta recusou o token. Os leads também não estão sendo lidos: gere um token novo e cole em Configurações › Meta Ads.":
    {
      es: "Tiempo real desactivado: Meta rechazó el token. Los leads tampoco se están leyendo: genera un token nuevo y pégalo en Configuración › Meta Ads.",
    },
  "Tempo real ainda não ligado: a Meta limitou as chamadas agora. O sistema tenta de novo sozinho; os leads continuam chegando pela leitura a cada 5 minutos.":
    {
      es: "Tiempo real aún no activado: Meta limitó las llamadas ahora. El sistema lo intenta de nuevo solo; los leads siguen llegando por la lectura cada 5 minutos.",
    },
  "Tempo real ainda não ligado: não foi possível falar com a Meta agora. O sistema tenta de novo sozinho; os leads continuam chegando pela leitura a cada 5 minutos.":
    {
      es: "Tiempo real aún no activado: no fue posible comunicarse con Meta ahora. El sistema lo intenta de nuevo solo; los leads siguen llegando por la lectura cada 5 minutos.",
    },
  "Tempo real desligado: a Meta recusou o pedido de assinatura da Página. É problema do sistema: avise quem mantém a instalação. Os leads continuam chegando pela leitura a cada 5 minutos.":
    {
      es: "Tiempo real desactivado: Meta rechazó el pedido de suscripción de la Página. Es un problema del sistema: avisa a quien mantiene la instalación. Los leads siguen llegando por la lectura cada 5 minutos.",
    },
  "Último lead pelo aviso da Meta:": { es: "Último lead por el aviso de Meta:" },
  "Ligar o tempo real": { es: "Activar el tiempo real" },
  "Quais perguntas são o telefone, o nome e o e-mail": {
    es: "Qué preguntas son el teléfono, el nombre y el correo",
  },
  "Pergunta do telefone": { es: "Pregunta del teléfono" },
  "Pergunta do nome": { es: "Pregunta del nombre" },
  "Pergunta do e-mail": { es: "Pregunta del correo" },
  "O automático usa:": { es: "El automático usa:" },
  "O automático não reconheceu nenhuma pergunta.": {
    es: "El automático no reconoció ninguna pregunta.",
  },
  "O telefone só é aceito se a resposta tiver DDD e número; senão o sistema tenta a próxima pergunta. Salve para valer nos próximos leads.":
    {
      es: "El teléfono solo se acepta si la respuesta tiene código de área y número; si no, el sistema prueba la siguiente pregunta. Guarda para que valga en los próximos leads.",
    },
  "Revisar formulários da Meta": { es: "Revisar formularios de Meta" },
  "Os leads da Meta pararam de chegar": { es: "Los leads de Meta dejaron de llegar" },
  "A leitura deste formulário na Meta está falhando.": {
    es: "La lectura de este formulario en Meta está fallando.",
  },
  // FORK MIA (.64) — a empresa com conta própria da Meta escolhe as Páginas dela
  // (migration 9008, lib/leads-da-meta/autoatendimento.ts).
  "Páginas desta empresa": { es: "Páginas de esta empresa" },
  "Marque as Páginas da Meta de onde esta empresa importa os formulários. Aparecem as Páginas que a conta da Meta conectada aqui alcança; pode ser uma ou várias.":
    {
      es: "Marca las Páginas de Meta de donde esta empresa importa los formularios. Aparecen las Páginas que alcanza la cuenta de Meta conectada aquí; puede ser una o varias.",
    },
  "Esta empresa lê as Páginas pela conexão da plataforma. Quem define de qual empresa é cada Página é quem administra a plataforma; para escolher as Páginas aqui, conecte a conta da Meta desta empresa na aba Contas de anúncio.":
    {
      es: "Esta empresa lee las Páginas con la conexión de la plataforma. Quien define de qué empresa es cada Página es quien administra la plataforma; para elegir las Páginas aquí, conecta la cuenta de Meta de esta empresa en la pestaña Cuentas publicitarias.",
    },
  "A conta da Meta conectada nesta empresa é a mesma da plataforma, que alcança as Páginas de outras empresas. Por isso quem define as Páginas desta empresa é o suporte. Para escolher aqui, conecte a conta da Meta da própria empresa.":
    {
      es: "La cuenta de Meta conectada en esta empresa es la misma de la plataforma, que alcanza las Páginas de otras empresas. Por eso quien define las Páginas de esta empresa es el soporte. Para elegir aquí, conecta la cuenta de Meta de la propia empresa.",
    },
  "A conta da Meta conectada não alcança nenhuma Página. No Gerenciador de Negócios, dê ao usuário do token acesso à Página (Usuários do sistema › Atribuir ativos › Páginas).":
    {
      es: "La cuenta de Meta conectada no alcanza ninguna Página. En el Administrador comercial, da al usuario del token acceso a la Página (Usuarios del sistema › Asignar activos › Páginas).",
    },
  "Marque uma Página para os formulários dela aparecerem aqui.": {
    es: "Marca una Página para que sus formularios aparezcan aquí.",
  },
  // FORK MIA (.65, migration 9009): desconectar a conta própria solta as Páginas.
  "Se a conta da Meta desta empresa for desconectada, as Páginas marcadas aqui são desmarcadas e os formulários delas param de ser importados. Ao conectar de novo, é só marcar outra vez.":
    {
      es: "Si se desconecta la cuenta de Meta de esta empresa, las Páginas marcadas aquí se desmarcan y sus formularios dejan de importarse. Al conectar de nuevo, basta con marcarlas otra vez.",
    },
  "Desmarcar esta Página?": { es: "¿Desmarcar esta Página?" },
  "Os formulários desta Página param de ser importados agora. Para voltar, marque a Página de novo e ligue os formulários.":
    {
      es: "Los formularios de esta Página dejan de importarse ahora. Para volver, marca la Página de nuevo y activa los formularios.",
    },
  "Esta Página já está ligada a outra empresa da plataforma. Fale com o suporte.": {
    es: "Esta Página ya está vinculada a otra empresa de la plataforma. Habla con el soporte.",
  },
  "Atribuída pela plataforma. Para desmarcar, fale com o suporte.": {
    es: "Asignada por la plataforma. Para desmarcarla, habla con el soporte.",
  },
  "A conta da Meta desta empresa não alcança mais esta Página.": {
    es: "La cuenta de Meta de esta empresa ya no alcanza esta Página.",
  },
  formulário: { es: "formulario" },
  formulários: { es: "formularios" },
  "Formulários de Páginas desmarcadas por esta empresa:": {
    es: "Formularios de Páginas desmarcadas por esta empresa:",
  },
  "Esta Página foi desmarcada por esta empresa, e a importação dos formulários dela foi desligada. Para voltar a importar, marque a Página de novo e ligue os formulários.":
    {
      es: "Esta Página fue desmarcada por esta empresa, y la importación de sus formularios se desactivó. Para volver a importar, marca la Página de nuevo y activa los formularios.",
    },
  "Cada Página da Meta é de uma empresa só, e a empresa vê e importa os formulários apenas das Páginas dela. Quem lê pela conexão da plataforma recebe as Páginas atribuídas aqui; a empresa com a própria conta da Meta conectada também marca as Páginas que essa conta alcança. Daqui se transfere ou corrige qualquer Página.":
    {
      es: "Cada Página de Meta es de una sola empresa, y la empresa ve e importa los formularios solo de sus Páginas. Quien lee con la conexión de la plataforma recibe las Páginas asignadas aquí; la empresa con su propia cuenta de Meta conectada también marca las Páginas que esa cuenta alcanza. Desde aquí se transfiere o corrige cualquier Página.",
    },
  "assumida pela empresa": { es: "tomada por la empresa" },
  "atribuída pela plataforma": { es: "asignada por la plataforma" },
  "lida pela conta da Meta da própria empresa": {
    es: "leída con la cuenta de Meta de la propia empresa",
  },
  // FORK MIA — ordem por coluna e filtro "só com impressão" na tabela de campanhas.
  "Só campanhas com impressão": { es: "Solo campañas con impresiones" },
  Mostrando: { es: "Mostrando" },
  "Voltar à ordem da plataforma": { es: "Volver al orden de la plataforma" },
  "Clique no nome da coluna para ordenar; clique de novo para inverter.": {
    es: "Haz clic en el nombre de la columna para ordenar; haz clic de nuevo para invertir.",
  },
  'Nenhuma campanha teve impressão neste período. Desligue a chave "Só campanhas com impressão" para ver todas.':
    { es: 'Ninguna campaña tuvo impresiones en este período. Desactiva "Solo campañas con impresiones" para ver todas.' },

  // ---- número de avisos da plataforma (o aviso de bastão no grupo) ----
  "Avisos no grupo": { es: "Avisos en el grupo" },
  "Não consegui carregar o número de avisos agora.": { es: "No pude cargar el número de avisos ahora." },
  "Número que avisa os grupos": { es: "Número que avisa a los grupos" },
  "Um número só para toda a plataforma. Conecte-o como um canal comum e adicione-o aos grupos dos clientes; é por ele que sai o aviso de lead qualificado.": { es: "Un único número para toda la plataforma. Conéctalo como un canal común y agrégalo a los grupos de los clientes; es por él que sale el aviso de lead calificado." },
  "Conectado.": { es: "Conectado." },
  "FORA DO AR — enquanto estiver assim, nenhum cliente recebe aviso.": { es: "FUERA DE SERVICIO — mientras siga así, ningún cliente recibe aviso." },
  "Desmarcar": { es: "Desmarcar" },
  "Nenhum número marcado — nenhum cliente recebe aviso no grupo.": { es: "Ningún número marcado — ningún cliente recibe aviso en el grupo." },
  "Trocar pelo número": { es: "Cambiar por el número" },
  "Usar este número": { es: "Usar este número" },
  "Escolha um número conectado": { es: "Elige un número conectado" },
  "Quem recebe em cada cliente": { es: "Quién recibe en cada cliente" },
  "Marque o número acima para escolher os grupos.": { es: "Marca el número de arriba para elegir los grupos." },
  "Não consegui perguntar ao WhatsApp quais são os grupos. O que já estava escolhido continua valendo.": { es: "No pude preguntarle a WhatsApp cuáles son los grupos. Lo que ya estaba elegido sigue valiendo." },
  "Este número ainda não está em nenhum grupo. Adicione-o pelo WhatsApp e recarregue.": { es: "Este número todavía no está en ningún grupo. Agrégalo por WhatsApp y recarga." },
  // FORK MIA (.62) — o aviso pelo número da própria empresa (components/admin/numero-de-avisos).
  "Os avisos saem pelo número desta empresa.": { es: "Los avisos salen por el número de esta empresa." },
  "O número escolhido não existe mais (foi arquivado ou removido).": { es: "El número elegido ya no existe (fue archivado o eliminado)." },
  "O número escolhido não entrega em grupo.": { es: "El número elegido no entrega en grupos." },
  "O número escolhido está fora do ar.": { es: "El número elegido está fuera de servicio." },
  "Enquanto isso, os avisos desta empresa estão saindo pelo número da plataforma (reserva).": { es: "Mientras tanto, los avisos de esta empresa están saliendo por el número de la plataforma (respaldo)." },
  "A reserva está ligada, mas o número da plataforma também não está disponível: os avisos desta empresa NÃO estão saindo.": { es: "El respaldo está activado, pero el número de la plataforma tampoco está disponible: los avisos de esta empresa NO están saliendo." },
  "Os avisos desta empresa NÃO estão saindo — a reserva pelo número da plataforma está desligada.": { es: "Los avisos de esta empresa NO están saliendo — el respaldo por el número de la plataforma está desactivado." },
  "Número que envia o aviso": { es: "Número que envía el aviso" },
  "Número da plataforma": { es: "Número de la plataforma" },
  "Número que não existe mais": { es: "Número que ya no existe" },
  "Se este número cair, mandar pelo número da plataforma (reserva)": { es: "Si este número se cae, enviar por el número de la plataforma (respaldo)" },
  "Não deu para listar os grupos deste número agora. O que já estava escolhido continua valendo.": { es: "No se pudieron listar los grupos de este número ahora. Lo que ya estaba elegido sigue valiendo." },
  "O número em uso não está no grupo": { es: "El número en uso no está en el grupo" },
  "o aviso não chega. Adicione o número ao grupo pelo WhatsApp ou escolha outro grupo.": { es: "el aviso no llega. Agrega el número al grupo por WhatsApp o elige otro grupo." },
  "A reserva só funciona se o número da plataforma também estiver no grupo": { es: "El respaldo solo funciona si el número de la plataforma también está en el grupo" },
  "— hoje ele não está.": { es: "— hoy no está." },
  "Cada empresa recebe pelo número da plataforma ou por um número que ela mesma conectou (por QR Code: a API oficial não manda mensagem para grupo). Os grupos da lista são os do número em uso.": { es: "Cada empresa recibe por el número de la plataforma o por un número que ella misma conectó (por código QR: la API oficial no envía mensajes a grupos). Los grupos de la lista son los del número en uso." },
  "Sem número da plataforma marcado, só as empresas com número próprio conseguem escolher o grupo.": { es: "Sin número de la plataforma marcado, solo las empresas con número propio pueden elegir el grupo." },
  // FORK MIA — a passagem prometida (lib/ai/decisao/tarefa-da-passagem-prometida.ts e o ponto handoff_promise).
  "Pegar a passagem prometida que não aconteceu": { es: "Detectar el traspaso prometido que no ocurrió" },
  "Lê cada resposta que o ATENDENTE envia, sozinha, e percebe quando ele diz ao cliente que a equipe vai dar sequência — para ninguém ficar esperando um contato que o time não sabe que tem de fazer.": {
    es: "Lee cada respuesta que envía el AGENTE, por separado, y detecta cuando le dice al cliente que el equipo va a darle seguimiento — para que nadie quede esperando un contacto que el equipo no sabe que tiene que hacer.",
  },
  "Quando o atendente disser ao cliente que a equipe vai dar sequência e nada tiver andado no turno, o Jev abre a passagem: caso na Central e aviso no grupo do time. O funil só vai a “qualificado” se a ficha do turno existir.": {
    es: "Cuando el agente le diga al cliente que el equipo va a darle seguimiento y nada haya avanzado en el turno, Jev abre el traspaso: caso en la Central y aviso en el grupo del equipo. El embudo solo pasa a “calificado” si existe la ficha del turno.",
  },
  "O Jev confere a resposta que saiu; se ela prometeu passar ao time e nada andou, a passagem é aberta.": {
    es: "Jev revisa la respuesta enviada; si prometió pasar al equipo y nada avanzó, se abre el traspaso.",
  },
  "A partir de agora, promessa de passagem sem nada andando vira passagem de verdade: a conversa sai do automático, a Central e o grupo do time são avisados.": {
    es: "A partir de ahora, una promesa de traspaso sin nada avanzando se convierte en un traspaso real: la conversación sale del modo automático y se avisa a la Central y al grupo del equipo.",
  },
  "dias, o Jev e o que o sistema fez concordaram em": { es: "días, Jev y lo que hizo el sistema coincidieron en" },
  "respostas — prometer passar ao time e o time ser mesmo avisado, ou nenhum dos dois.": {
    es: "respuestas — prometer pasar al equipo y que el equipo sea realmente avisado, o ninguna de las dos cosas.",
  },
  "delas o atendente prometeu passar ao time e nada andou no mesmo turno — é o que o Jev pegaria decidindo.": {
    es: "de ellas el agente prometió pasar al equipo y nada avanzó en el mismo turno — es lo que Jev detectaría decidiendo.",
  },
  "Confere se a resposta que o atendente enviou promete ao cliente que a equipe vai dar sequência, quando ninguém do time foi avisado.": {
    es: "Revisa si la respuesta que envió el agente le promete al cliente que el equipo va a darle seguimiento, cuando nadie del equipo fue avisado.",
  },
  "O agente diz ao cliente que vai encaminhar para a equipe, e ninguém do time fica sabendo — o cliente espera um contato que não vem.": {
    es: "El agente le dice al cliente que lo va a pasar al equipo y nadie del equipo se entera — el cliente espera un contacto que no llega.",
  },
  "Quem responde aqui é o Jev, numa pergunta de sim ou não sobre a resposta que já saiu. Não há modelo de conversa para trocar.": {
    es: "Aquí responde Jev, con una pregunta de sí o no sobre la respuesta que ya se envió. No hay modelo de conversación para cambiar.",
  },
  // FORK MIA — o aviso ao time no histórico do negócio (lib/avisos/registro-do-aviso.ts).
  "Aviso enviado ao time no grupo": { es: "Aviso enviado al equipo en el grupo" },
  "O aviso ao time não saiu": { es: "El aviso al equipo no salió" },
  "O que foi mandado ao grupo": { es: "Lo que se envió al grupo" },
  // FORK MIA — a marca por empresa travada (lib/branding/marca-da-organizacao-no-fork.ts).
  "A marca é definida pela plataforma: nome, cor e logo são os mesmos para todas as empresas.": { es: "La marca la define la plataforma: nombre, color y logo son los mismos para todas las empresas." },
  "Para trocar a marca de todas as empresas, use o painel da plataforma:": { es: "Para cambiar la marca de todas las empresas, usa el panel de la plataforma:" },
  "Marca da instalação": { es: "Marca de la instalación" },
  // FORK MIA — o porquê da lista de grupos não ter vindo (MotivoDaFalhaDeGrupos).
  "O WhatsApp não respondeu a tempo. Recarregue a página em instantes.": { es: "WhatsApp no respondió a tiempo. Recarga la página en unos instantes." },
  "O serviço do WhatsApp não está configurado nesta instalação.": { es: "El servicio de WhatsApp no está configurado en esta instalación." },
  "A chave do serviço do WhatsApp foi recusada — confira a configuração do servidor. Ler o QR de novo não resolve.": { es: "La clave del servicio de WhatsApp fue rechazada — revisa la configuración del servidor. Leer el QR de nuevo no lo resuelve." },
  "A sessão deste número não existe mais no WhatsApp. Reconecte o número pelo QR.": { es: "La sesión de este número ya no existe en WhatsApp. Reconecta el número por el QR." },
  "O número não está conectado agora. Reconecte-o (leia o QR de novo) e recarregue.": { es: "El número no está conectado ahora. Reconéctalo (lee el QR de nuevo) y recarga." },
  "O WhatsApp recusou a consulta dos grupos. Tente de novo em instantes.": { es: "WhatsApp rechazó la consulta de los grupos. Inténtalo de nuevo en unos instantes." },
  "Não foi possível consultar os grupos agora. Tente de novo em instantes.": { es: "No fue posible consultar los grupos ahora. Inténtalo de nuevo en unos instantes." },
  "Grupo que recebe o aviso": { es: "Grupo que recibe el aviso" },
  "endereço público do arquivo (https://…)": { es: "dirección pública del archivo (https://…)" },
  "Sem aviso": { es: "Sin aviso" },
  // FORK MIA (.61) — o número da abordagem no gatilho "Lead criado" (lib/followup/numero-do-gatilho.ts).
  "Número que faz a abordagem": { es: "Número que hace el primer contacto" },
  "Automático (como hoje)": { es: "Automático (como hasta ahora)" },
  "Outro canal": { es: "Otro canal" },
  "Número excluído": { es: "Número eliminado" },
  "Não consegui carregar os números da empresa. Recarregue a página.": { es: "No pude cargar los números de la empresa. Recarga la página." },
  "Automático: sai pelo número da conversa mais recente com o contato ou, sem conversa, pelo número conectado mais antigo da empresa.": { es: "Automático: sale por el número de la conversación más reciente con el contacto o, sin conversación, por el número conectado más antiguo de la empresa." },
  "O primeiro contato sai só por este número. Se ele estiver desconectado ou for excluído, o lead não entra no fluxo: o sistema não troca de número sozinho.": { es: "El primer contacto sale solo por este número. Si está desconectado o se elimina, el lead no entra en el flujo: el sistema no cambia de número por su cuenta." },
  "Este número está desconectado agora. Enquanto ele não voltar, os leads novos não entram neste fluxo.": { es: "Este número está desconectado ahora. Mientras no vuelva, los leads nuevos no entran en este flujo." },
  "O número escolhido foi excluído. Escolha outro número ou volte para o automático.": { es: "El número elegido fue eliminado. Elige otro número o vuelve al automático." },
  "O número escolhido para o gatilho não é desta empresa ou foi excluído. Escolha outro número.": { es: "El número elegido para el disparador no es de esta empresa o fue eliminado. Elige otro número." },
  // FORK MIA (.61) — o modelo aprovado do fluxo leva o primeiro nome (lib/channels/meta/variavel-do-nome.ts).
  "O primeiro nome do contato entra em": { es: "El primer nombre del contacto va en" },
  "Sem origem escolhida abaixo:": { es: "Sin origen elegido abajo:" },
  "Sem nome cadastrado, entra «tudo bem».": { es: "Sin nombre registrado, va «tudo bem»." },
  "Sem nome cadastrado, o passo é pulado.": { es: "Sin nombre registrado, el paso se omite." },

  // ---- empresas (o cliente que é uma organização) ----
  "Empresas": { es: "Empresas" },
  // A descrição do item no menu, no hub e no ⌘K (lib/navigation/catalogo.ts).
  "Os clientes que são empresa — cada uma com suas pessoas e seus negócios.": { es: "Los clientes que son empresa — cada una con sus personas y sus negocios." },
  // "Nova empresa", "Editar empresa" e "Negócios" também são usadas por estas
  // telas, mas moram nos blocos do UPSTREAM (empresas dele e relatório de
  // perdas; "Nova empresa" foi para o bloco do CNPJ na 1.72), com a mesma
  // tradução. Repetir aqui reprova o tsc (TS1117), e tirar de lá faria o bloco
  // dele conflitar em toda sincronização — foi o que aconteceu na fusão da v1.60.0.
  "Site": { es: "Sitio web" },
  "Observações": { es: "Observaciones" },
  "Pessoas desta empresa": { es: "Personas de esta empresa" },
  "Nenhum contato vinculado ainda. O vínculo se faz na ficha do contato.": { es: "Todavía no hay contactos vinculados. El vínculo se hace en la ficha del contacto." },
  "Nenhum negócio vinculado ainda.": { es: "Todavía no hay negocios vinculados." },
  "Total ganho": { es: "Total ganado" },
  "Os clientes que são empresa. Cada uma reúne as pessoas e os negócios dela.": { es: "Los clientes que son empresa. Cada una reúne a sus personas y sus negocios." },
  "Nenhuma empresa encontrada com esse termo.": { es: "Ninguna empresa encontrada con ese término." },
  "Nenhuma empresa cadastrada ainda.": { es: "Todavía no hay empresas registradas." },
  "Sem empresa": { es: "Sin empresa" },
  "Empresa vinculada": { es: "Empresa vinculada" },

  // ---- modelo de IA da plataforma ----
  "Não consegui carregar o catálogo de modelos agora.": { es: "No pude cargar el catálogo de modelos ahora." },
  "Modelo de IA da plataforma": { es: "Modelo de IA de la plataforma" },
  "Vale para todas as empresas que não escolheram outro. Quem contrata não escolhe o modelo — assim como não escolhe a chave de IA: é engrenagem nossa, e a conta também.": { es: "Vale para todas las empresas que no eligieron otro. Quien contrata no elige el modelo — igual que no elige la clave de IA: es engranaje nuestro, y la cuenta también." },
  "Automático (o sistema escolhe pelo catálogo)": { es: "Automático (el sistema elige por el catálogo)" },
  "A lista traz só os modelos que sabem usar ferramentas — é o que o agente precisa para mexer no funil.": { es: "La lista trae solo los modelos que saben usar herramientas — es lo que el agente necesita para mover el embudo." },
  "Agentes já publicados continuam com o modelo que tinham — a troca vale para os próximos.": { es: "Los agentes ya publicados siguen con el modelo que tenían — el cambio vale para los próximos." },
  "Modelo de IA": { es: "Modelo de IA" },

  // ---- cadastro incorporado da Meta ----
  "Não consegui carregar o cadastro incorporado agora.": { es: "No pude cargar el registro incorporado ahora." },
  "Link do cadastro incorporado": { es: "Enlace del registro incorporado" },
  "Gere o link no painel da Meta (Torne-se um parceiro › Cadastro incorporado hospedado) e cole aqui. Sem link, a tela do cliente mostra só a conexão manual.": { es: "Genera el enlace en el panel de Meta (Conviértete en socio › Registro incorporado alojado) y pégalo aquí. Sin enlace, la pantalla del cliente muestra solo la conexión manual." },
  // "Link" mora no bloco do upstream (captação, 1.70), com a mesma tradução.
  "Contas que chegaram": { es: "Cuentas que llegaron" },
  "Nenhuma conta esperando. Quando um cliente terminar o cadastro, ela aparece aqui.": { es: "Ninguna cuenta esperando. Cuando un cliente termine el registro, aparece aquí." },
  "De qual cliente é esta conta": { es: "De qué cliente es esta cuenta" },
  "De qual cliente é esta conta?": { es: "¿De qué cliente es esta cuenta?" },
  "Amarrar": { es: "Vincular" },
  "A Meta ainda não mandou o número desta conta. Ela avisa de novo quando mandar.": { es: "Meta todavía no envió el número de esta cuenta. Avisa de nuevo cuando lo envíe." },
  "Já amarradas": { es: "Ya vinculadas" },
  "O jeito rápido: você entra com a conta do Facebook da sua empresa e escolhe o número por lá. Nada para copiar e colar.": { es: "La forma rápida: entras con la cuenta de Facebook de tu empresa y eliges el número allí. Nada que copiar y pegar." },
  "Entrar com o Facebook": { es: "Entrar con Facebook" },
  "Quando terminar, avise a gente: o número aparece aqui depois que a Meta confirmar.": { es: "Cuando termines, avísanos: el número aparece aquí después de que Meta confirme." },
  "Ou configurar manualmente": { es: "O configurar manualmente" },
  "Cadastro incorporado": { es: "Registro incorporado" },

  // ---- report interno da plataforma ----
  "Grupo que recebe": { es: "Grupo que recibe" },
  "Avisar quando o crédito de IA cair abaixo de (US$)": { es: "Avisar cuando el crédito de IA baje de (US$)" },
  "Mandar o resumo do dia, às 8h": { es: "Enviar el resumen del día, a las 8h" },
  "Report interno (o nosso grupo)": { es: "Reporte interno (nuestro grupo)" },
  "Conectar um número novo": { es: "Conectar un número nuevo" },
  "O número precisa morar em uma das organizações (normalmente a sua) — é assim que ele entra no vigia de saúde e na reconexão. O papel de número de avisos é da plataforma; a organização é só o endereço dele.": { es: "El número tiene que vivir en una de las organizaciones (normalmente la tuya) — así entra en el vigía de salud y en la reconexión. El papel de número de avisos es de la plataforma; la organización es solo su dirección." },
  "Organização do número": { es: "Organización del número" },
  "Em qual organização ele fica?": { es: "¿En qué organización queda?" },
  "Conectar e mostrar o QR": { es: "Conectar y mostrar el QR" },
  "Abra o WhatsApp do número, vá em Aparelhos conectados e leia o código:": { es: "Abre el WhatsApp del número, ve a Dispositivos vinculados y lee el código:" },
  "Código QR": { es: "Código QR" },
  "Assim que o celular ler, recarregue esta página: o número aparece marcado acima.": { es: "En cuanto el celular lo lea, recarga esta página: el número aparece marcado arriba." },
  "Ou usar um número já conectado": { es: "O usar un número ya conectado" },

  // ---- fila morta (trabalho parado) ----
  "Não consegui carregar a fila agora.": { es: "No pude cargar la cola ahora." },
  "Trabalho parado": { es: "Trabajo detenido" },
  "Nada parado. Todo trabalho que entrou foi processado.": { es: "Nada detenido. Todo el trabajo que entró fue procesado." },
  "Cada um destes é um atendimento que não aconteceu. Agrupados pelo motivo da falha.": { es: "Cada uno de estos es una atención que no ocurrió. Agrupados por el motivo de la falla." },
  "A lista foi cortada — há mais do que cabe nesta tela.": { es: "La lista fue cortada — hay más de lo que cabe en esta pantalla." },
  "parado": { es: "detenido" },
  "parados": { es: "detenidos" },
  "Sem motivo registrado.": { es: "Sin motivo registrado." },
  "Parado desde": { es: "Detenido desde" },

  // ---- arquivo da campanha, sem hospedagem ----
  "Arquivo enviado.": { es: "Archivo enviado." },
  "escolha o arquivo abaixo, ou cole um endereço público": { es: "elige el archivo abajo, o pega una dirección pública" },
  "O mesmo número, falando com a gente: crédito de IA acabando, número fora do ar e um resumo por dia. Cada aviso sai no máximo uma vez por dia enquanto o problema durar.": { es: "El mismo número, hablando con nosotros: crédito de IA acabándose, número fuera del aire y un resumen por día. Cada aviso sale como máximo una vez al día mientras el problema dure." },
  "Vincular a uma empresa": { es: "Vincular a una empresa" },
  "Usar o número e o grupo do painel": { es: "Usar el número y el grupo del panel" },
  "O aviso sai pelo número da plataforma, no grupo escolhido para este cliente no painel administrativo.": { es: "El aviso sale por el número de la plataforma, al grupo elegido para este cliente en el panel administrativo." },
  "O e-mail do encarregado não parece um e-mail.": {
    es: "El correo del encargado no parece un correo.",
  },
  "O endereço da política precisa começar com https://": {
    es: "La dirección de la política debe empezar con https://",
  },
  "Confira os campos do responsável legal.": {
    es: "Revise los campos del responsable legal.",
  },
  "Responsável legal salvo.": {
    es: "Responsable legal guardado.",
  },
  "Não deu para salvar o responsável legal.": {
    es: "No se pudo guardar el responsable legal.",
  },
  "Responsável legal desta instalação": {
    es: "Responsable legal de esta instalación",
  },
  "As páginas de Política de Privacidade e Termos de Uso precisam dizer QUEM responde pelos dados tratados aqui. Preenchendo a razão social abaixo, elas passam a nomear esta empresa para qualquer pessoa que as abrir. Deixando em branco, elas nomeiam a empresa que estiver selecionada na sessão de quem está lendo — o que só faz sentido quando a instalação inteira é de uma empresa só.": {
    es: "Las páginas de Política de Privacidad y Términos de Uso deben decir QUIÉN responde por los datos tratados aquí. Al completar la razón social de abajo, pasan a nombrar a esta empresa para cualquier persona que las abra. Dejándola en blanco, nombran a la empresa que esté seleccionada en la sesión de quien lee — lo que solo tiene sentido cuando la instalación entera es de una sola empresa.",
  },
  "Nome da empresa no CNPJ": {
    es: "Nombre de la empresa en el registro fiscal",
  },
  "Em vigor: os documentos legais nomeiam esta empresa, para todo mundo que os abrir.": {
    es: "En vigor: los documentos legales nombran a esta empresa, para todos los que los abran.",
  },
  "Em branco: os documentos legais nomeiam a empresa selecionada na sessão de quem lê.": {
    es: "En blanco: los documentos legales nombran a la empresa seleccionada en la sesión de quien lee.",
  },
  "E-mail do encarregado de dados": {
    es: "Correo del encargado de datos",
  },
  "Endereço da política própria": {
    es: "Dirección de la política propia",
  },
  "Se a empresa já publica a política dela em outro endereço, ponha aqui: a página do sistema passa a levar para lá em vez de mostrar o texto padrão.": {
    es: "Si la empresa ya publica su política en otra dirección, póngala aquí: la página del sistema pasa a llevar allí en lugar de mostrar el texto estándar.",
  },
  "Salvar responsável legal": {
    es: "Guardar responsable legal",
  },
  "Para quem esta empresa vende": {
    es: "A quién le vende esta empresa",
  },
  "Para outras empresas": {
    es: "A otras empresas",
  },
  "Direto para pessoas": {
    es: "Directo a personas",
  },
  "A aba Empresas some do menu, o cadastro deixa de pedir empresa, cargo e setor, e a IA não oferece mais a capacidade de anotar a empresa do cliente. Os dados já cadastrados continuam no banco.": {
    es: "La pestaña Empresas desaparece del menú, el registro deja de pedir empresa, cargo y sector, y la IA ya no ofrece la capacidad de anotar la empresa del cliente. Los datos ya registrados siguen en la base.",
  },
  "O sistema agrupa contatos e negócios por empresa: a aba Empresas fica no menu, o cadastro pede empresa, cargo e setor, e a IA pode anotar de qual empresa o cliente é.": {
    es: "El sistema agrupa contactos y negocios por empresa: la pestaña Empresas queda en el menú, el registro pide empresa, cargo y sector, y la IA puede anotar de qué empresa es el cliente.",
  },
  "O lead respondeu: a régua sai de cena e a conversa segue com o agente ou com uma pessoa.": {
    es: "El lead respondió: la secuencia sale de escena y la conversación sigue con el agente o con una persona.",
  },
  "O lead respondeu: a régua avança para o passo seguinte — e se o passo seguinte for a despedida, ela se despede de quem acabou de falar com você.": {
    es: "El lead respondió: la secuencia avanza al paso siguiente — y si el paso siguiente es la despedida, se despide de quien acaba de hablar contigo.",
  },
  "Estado do schema": {
    es: "Estado del esquema",
  },
  "Não consegui ler o carimbo do schema. Num banco que ainda não recebeu a migration 0268 isso é esperado; em qualquer outro caso, é sinal de que o baseline não chegou ao fim.": {
    es: "No pude leer el sello del esquema. En una base que todavía no recibió la migración 0268 esto es esperado; en cualquier otro caso, es señal de que el baseline no llegó al final.",
  },
  "precisa de atenção": {
    es: "necesita atención",
  },
  "O banco recebeu": {
    es: "La base recibió",
  },
  "Esta versão espera": {
    es: "Esta versión espera",
  },
  "Carimbado em": {
    es: "Sellado el",
  },
  "Erros ao aplicar": {
    es: "Errores al aplicar",
  },
  "O banco está numa entrega diferente da desta versão do sistema. Ou o baseline não passou no último deploy, ou a imagem no ar é outra — as duas linhas acima dizem qual das duas.": {
    es: "La base está en una entrega diferente de la de esta versión del sistema. O el baseline no pasó en el último despliegue, o la imagen en el aire es otra — las dos líneas de arriba dicen cuál de las dos.",
  },
  "O baseline chegou ao fim, mas o Postgres recusou pelo menos um comando pelo caminho. Num banco que já existe isso não derruba o sistema — e é por isso que passava despercebido. As primeiras linhas:": {
    es: "El baseline llegó al final, pero Postgres rechazó al menos un comando en el camino. En una base que ya existe eso no tumba el sistema — y por eso pasaba desapercibido. Las primeras líneas:",
  },
  "(sem amostra gravada)": {
    es: "(sin muestra registrada)",
  },
  "A validade precisa ser um número de dias, ou ficar em branco.": {
    es: "La validez debe ser un número de días, o quedar en blanco.",
  },
  "Por que está revogando este token?": {
    es: "¿Por qué está revocando este token?",
  },
  "Token revogado:": {
    es: "Token revocado:",
  },
  "Copie agora — isto não aparece de novo": {
    es: "Cópielo ahora — esto no aparece de nuevo",
  },
  "Só o resumo criptográfico fica gravado. Se perder, a saída é revogar este e emitir outro.": {
    es: "Solo el resumen criptográfico queda guardado. Si lo pierde, la salida es revocar este y emitir otro.",
  },
  "Emitir um token": {
    es: "Emitir un token",
  },
  "ex: implantação de clientes": {
    es: "ej: implantación de clientes",
  },
  "Validade em dias": {
    es: "Validez en días",
  },
  "em branco = não expira": {
    es: "en blanco = no expira",
  },
  "Por que este token existe": {
    es: "Por qué existe este token",
  },
  "quem vai usar, e para quê": {
    es: "quién lo va a usar, y para qué",
  },
  "Quem for auditar daqui a seis meses lê esta frase, não o nome.": {
    es: "Quien audite dentro de seis meses lee esta frase, no el nombre.",
  },
  "O que este token pode ESCREVER": {
    es: "Lo que este token puede ESCRIBIR",
  },
  "Nenhuma marcada = o token só lê, e ler é livre. Cada caixinha diz o que acontece se ele vazar.": {
    es: "Ninguna marcada = el token solo lee, y leer es libre. Cada casilla dice qué pasa si se filtra.",
  },
  "Emitindo...": {
    es: "Emitiendo...",
  },
  "Emitir token": {
    es: "Emitir token",
  },
  "Tokens emitidos": {
    es: "Tokens emitidos",
  },
  "Nenhum token emitido ainda.": {
    es: "Ningún token emitido todavía.",
  },
  "só leitura": {
    es: "solo lectura",
  },
  "escreve:": {
    es: "escribe:",
  },
  "Motivo da revogação:": {
    es: "Motivo de la revocación:",
  },
  "Tokens de plataforma": {
    es: "Tokens de plataforma",
  },
  "Credenciais que administram a instalação inteira por conversa, pelo MCP. Um token de cliente erra dentro daquele cliente; um destes erra em todos — por isso cada escrita é liberada uma a uma, e um token sem nenhuma marcada só lê.": {
    es: "Credenciales que administran la instalación entera por conversación, por el MCP. Un token de cliente se equivoca dentro de aquel cliente; uno de estos se equivoca en todos — por eso cada escritura se libera una a una, y un token sin ninguna marcada solo lee.",
  },
  "O catálogo não tem nenhum modelo que saiba usar ferramentas. Enquanto estiver assim, não dá para fixar modelo — e o automático escolhe da mesma lista vazia.": {
    es: "El catálogo no tiene ningún modelo que sepa usar herramientas. Mientras siga así, no se puede fijar un modelo — y el automático elige de esa misma lista vacía.",
  },
  "Operadora de IA": {
    es: "Proveedor de IA",
  },
  "Todas as operadoras": {
    es: "Todos los proveedores",
  },
  "sem chave nesta instalação": {
    es: "sin clave en esta instalación",
  },
  "Filtra a lista abaixo. Não é a escolha — quem decide é o modelo.": {
    es: "Filtra la lista de abajo. No es la elección — quien decide es el modelo.",
  },
  "nome ou identificador (ex: sonnet, gpt-4.1)": {
    es: "nombre o identificador (ej: sonnet, gpt-4.1)",
  },
  "modelos no catálogo": {
    es: "modelos en el catálogo",
  },
  "modelos": {
    es: "modelos",
  },
  "fora do catálogo": {
    es: "fuera del catálogo",
  },
  "fora do filtro": {
    es: "fuera del filtro",
  },
  "Nenhum modelo passa por esse filtro. Continuam na lista o Automático e o que está valendo agora.": {
    es: "Ningún modelo pasa por ese filtro. Siguen en la lista el Automático y el que está vigente ahora.",
  },
  "O modelo fixado saiu do catálogo (obsoleto, ou deixou de usar ferramentas). Enquanto ele estiver aqui, NENHUM cliente novo consegue publicar agente. Escolha outro e salve.": {
    es: "El modelo fijado salió del catálogo (obsoleto, o dejó de usar herramientas). Mientras siga aquí, NINGÚN cliente nuevo logra publicar agente. Elija otro y guarde.",
  },
  "Esta instalação não tem chave desta operadora. Cliente novo não tem credencial própria, então ele não vai conseguir publicar agente com este modelo — cadastre a chave antes de salvar.": {
    es: "Esta instalación no tiene clave de este proveedor. El cliente nuevo no tiene credencial propia, así que no va a lograr publicar agente con este modelo — registre la clave antes de guardar.",
  },

  // FORK MIA: a galeria por segmento (lib/followup/modelos/segmentos.ts). Os
  // rótulos, as jornadas e os resumos chegam por chave dinâmica; quem cobra o
  // espanhol é lib/followup/modelos/modelos.test.ts.
  "Fluxos com os textos já escritos, para os momentos em que um cliente some no meio do caminho. Escolha o seu segmento. Instalar não manda mensagem para ninguém: o fluxo nasce como rascunho para você revisar.": {
    es: "Flujos con los textos ya escritos para los momentos en que un cliente desaparece a mitad de camino. Elige tu segmento. Instalar un flujo no envía mensajes a nadie: se crea como borrador para que lo revises.",
  },
  "Segmento do seu negócio": { es: "Segmento de tu negocio" },
  "Saúde e estética": { es: "Salud y estética" },
  "Imobiliário": { es: "Inmobiliario" },
  "Automotivo": { es: "Automotriz" },
  "Academias e bem-estar": { es: "Gimnasios y bienestar" },
  "Serviços B2B": { es: "Servicios B2B" },
  "Indústria e distribuição B2B": { es: "Industria y distribución B2B" },
  "Cotação": { es: "Cotización" },
  Retomada: { es: "Reactivación" },
  "Test drive": { es: "Prueba de manejo" },
  "Negociação": { es: "Negociación" },
  "Aula experimental": { es: "Clase de prueba" },
  "Matrícula": { es: "Inscripción" },
  "Um dia inteiro sem o cliente responder, com a conversa em aberto.": {
    es: "Un día entero sin que el cliente responda, con la conversación pendiente.",
  },
  "Alguém confirmar na agenda que o cliente não compareceu.": {
    es: "Que alguien confirme en la agenda que el cliente no asistió.",
  },
  "O cliente chamou, a conversa parou antes do próximo passo e ninguém voltou nela.": {
    es: "El cliente escribió, la conversación se detuvo antes del siguiente paso y nadie la retomó.",
  },
  "O cliente mostrou interesse e ainda não marcou a visita, a reunião ou o atendimento. O fluxo lembra por duas semanas e sai de cena.": {
    es: "El cliente mostró interés y todavía no agendó la visita, la reunión o la cita. El flujo le recuerda durante dos semanas y después se retira.",
  },
  "Quem recebeu a proposta e não respondeu nem sempre desistiu: pode estar decidindo. O fluxo acompanha por quase três meses, sem pressionar.": {
    es: "Quien recibió la propuesta y no respondió no siempre desistió: puede estar decidiendo. El flujo da seguimiento durante casi tres meses, sin presionar.",
  },
  "O cliente não compareceu ao horário marcado. O fluxo oferece outra data em vez de deixar a conversa esfriar.": {
    es: "El cliente no asistió a la hora agendada. El flujo ofrece otra fecha en lugar de dejar que la conversación se enfríe.",
  },
  "A pessoa perguntou sobre um imóvel, a conversa parou antes da visita e ninguém voltou nela.": {
    es: "La persona preguntó por un inmueble, la conversación se detuvo antes de la visita y nadie la retomó.",
  },
  "O cliente se interessou por um imóvel e ainda não marcou a visita. O fluxo lembra por duas semanas e sai de cena.": {
    es: "El cliente se interesó por un inmueble y todavía no agendó la visita. El flujo le recuerda durante dos semanas y después se retira.",
  },
  "Comprar um imóvel é uma decisão grande, e quem visitou ou recebeu proposta costuma levar semanas. O fluxo acompanha por quase três meses, sem pressionar.": {
    es: "Comprar un inmueble es una decisión grande, y quien visitó o recibió una propuesta suele tardar semanas. El flujo da seguimiento durante casi tres meses, sin presionar.",
  },
  "O cliente não apareceu na visita marcada. O fluxo oferece outra data em vez de deixar o interesse esfriar.": {
    es: "El cliente no llegó a la visita agendada. El flujo ofrece otra fecha en lugar de dejar que el interés se enfríe.",
  },
  "A pessoa perguntou sobre um carro, a conversa parou antes de ela vir à loja e ninguém voltou nela.": {
    es: "La persona preguntó por un auto, la conversación se detuvo antes de que viniera a la tienda y nadie la retomó.",
  },
  "O cliente se interessou por um carro e ainda não marcou o test drive ou a visita à loja. O fluxo lembra por duas semanas e sai de cena.": {
    es: "El cliente se interesó por un auto y todavía no agendó la prueba de manejo ni la visita a la tienda. El flujo le recuerda durante dos semanas y después se retira.",
  },
  "Quem viu o carro e recebeu proposta pode estar comparando, vendendo o usado ou esperando o crédito. O fluxo acompanha por cerca de um mês e meio, sem pressionar.": {
    es: "Quien vio el auto y recibió una propuesta puede estar comparando, vendiendo su usado o esperando el crédito. El flujo da seguimiento durante cerca de un mes y medio, sin presionar.",
  },
  "O cliente não apareceu no horário marcado na loja. O fluxo oferece outra data em vez de deixar o interesse esfriar.": {
    es: "El cliente no llegó a la hora agendada en la tienda. El flujo ofrece otra fecha en lugar de dejar que el interés se enfríe.",
  },
  "A pessoa perguntou sobre planos ou horários, a conversa parou antes da matrícula e ninguém voltou nela.": {
    es: "La persona preguntó por planes u horarios, la conversación se detuvo antes de la inscripción y nadie la retomó.",
  },
  "O cliente quis conhecer o espaço e ainda não marcou a aula experimental. O fluxo lembra por duas semanas e sai de cena.": {
    es: "El cliente quiso conocer el lugar y todavía no agendó la clase de prueba. El flujo le recuerda durante dos semanas y después se retira.",
  },
  "Quem fez a aula experimental ou pediu valores e não se matriculou pode estar só organizando a rotina. O fluxo acompanha por cerca de um mês e meio, sem pressionar.": {
    es: "Quien tomó la clase de prueba o pidió precios y no se inscribió puede estar solo organizando su rutina. El flujo da seguimiento durante cerca de un mes y medio, sin presionar.",
  },
  "O cliente não apareceu na aula experimental. O fluxo oferece outro horário em vez de deixar a vontade de começar passar.": {
    es: "El cliente no llegó a la clase de prueba. El flujo ofrece otro horario en lugar de dejar que se le pasen las ganas de empezar.",
  },
  "A empresa chamou, a conversa parou antes de marcar uma reunião e ninguém voltou nela.": {
    es: "La empresa escribió, la conversación se detuvo antes de agendar una reunión y nadie la retomó.",
  },
  "A empresa mostrou interesse e a reunião ainda não foi marcada. O fluxo lembra por duas semanas e sai de cena.": {
    es: "La empresa mostró interés y la reunión todavía no se agendó. El flujo le recuerda durante dos semanas y después se retira.",
  },
  "Proposta enviada costuma passar por mais de uma pessoa antes do sim. O fluxo acompanha por quase três meses, sem pressionar.": {
    es: "Una propuesta enviada suele pasar por más de una persona antes del sí. El flujo da seguimiento durante casi tres meses, sin presionar.",
  },
  "A reunião estava marcada e a pessoa não entrou. O fluxo oferece outro horário em vez de deixar a oportunidade esfriar.": {
    es: "La reunión estaba agendada y la persona no se conectó. El flujo ofrece otro horario en lugar de dejar que la oportunidad se enfríe.",
  },
  "A revenda ou o instalador pediu informação de produto, a conversa parou antes da cotação e ninguém voltou nela.": {
    es: "La reventa o el instalador pidió información de producto, la conversación se detuvo antes de la cotización y nadie la retomó.",
  },
  "O cliente quis conhecer a linha de produtos e a visita do representante ainda não foi marcada. O fluxo lembra por duas semanas e sai de cena.": {
    es: "El cliente quiso conocer la línea de productos y la visita del representante todavía no se agendó. El flujo le recuerda durante dos semanas y después se retira.",
  },
  "Quem recebeu a cotação costuma comparar com outros fornecedores e conferir o próprio estoque antes de pedir. O fluxo acompanha por cerca de um mês e meio, sem pressionar.": {
    es: "Quien recibió la cotización suele compararla con otros proveedores y revisar su propio inventario antes de pedir. El flujo da seguimiento durante cerca de un mes y medio, sin presionar.",
  },
  "A visita estava marcada e o representante não conseguiu ser recebido. O fluxo oferece outra data em vez de deixar o interesse esfriar.": {
    es: "La visita estaba agendada y el representante no pudo ser recibido. El flujo ofrece otra fecha en lugar de dejar que el interés se enfríe.",
  },
};
