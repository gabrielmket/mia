/**
 * FORK MIA (.89) — as frases de tela do DISPARO DE E-MAIL MARKETING (a
 * configuração, o caminho E-mail do Broadcast, a campanha em quatro telas, o
 * consentimento na ficha e a página pública de preferências), em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha
 * (`...DICIONARIO_DO_EMAIL_MARKETING`), para a sincronização com o upstream não
 * conflitar a cada frase nova (docs/FORK-MIA.md, regra 1). A chave é o texto
 * em português.
 *
 * ⚠️ Não repita aqui uma chave que o upstream já traduz.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DO_EMAIL_MARKETING: Traducoes = {
  // ── a configuração (Configurações › E-mail marketing) ──
  "E-mail marketing": { es: "E-mail marketing" },
  "Domínio, remetentes, rodapé, ritmo e lista de supressão das campanhas de e-mail.": {
    es: "Dominio, remitentes, pie de página, ritmo y lista de supresión de las campañas de e-mail.",
  },
  "A configuração de e-mail é do administrador. O que a atendente faz é registrar o consentimento na ficha do contato.":
    {
      es: "La configuración de e-mail es del administrador. Lo que hace el agente es registrar el consentimiento en la ficha del contacto.",
    },
  "Não consegui carregar a configuração do e-mail.": {
    es: "No pude cargar la configuración del e-mail.",
  },
  "O disparo por e-mail é vendido à parte": { es: "El envío por e-mail se vende por separado" },
  "Com o módulo, a empresa manda campanhas de e-mail para a própria base, pelo domínio dela, com descadastro de um clique e lista de supressão. O custo sai da carteira de créditos, a mesma do número oficial.":
    {
      es: "Con el módulo, la empresa envía campañas de e-mail a su propia base, desde su dominio, con baja en un clic y lista de supresión. El costo sale de la cartera de créditos, la misma del número oficial.",
    },
  "Quem libera é quem cuida da sua conta. O registro de consentimento na ficha do contato continua valendo, com ou sem o módulo.":
    {
      es: "Quien lo habilita es quien gestiona tu cuenta. El registro de consentimiento en la ficha del contacto sigue valiendo, con o sin el módulo.",
    },
  "Você vê a configuração, mas só o administrador muda domínio, remetente, rodapé e ritmo.": {
    es: "Ves la configuración, pero solo el administrador cambia dominio, remitente, pie de página y ritmo.",
  },
  "Esta é a empresa de demonstração: tudo funciona com dados fictícios e nenhum e-mail sai, nem o teste.":
    {
      es: "Esta es la empresa de demostración: todo funciona con datos ficticios y no sale ningún e-mail, ni siquiera la prueba.",
    },
  "Módulo e carteira": { es: "Módulo y cartera" },
  Contratado: { es: "Contratado" },
  "Não contratado": { es: "No contratado" },
  "Preço por e-mail": { es: "Precio por e-mail" },
  "Preço por e-mail:": { es: "Precio por e-mail:" },
  "por e-mail aceito pela Amazon": { es: "por e-mail aceptado por Amazon" },
  "o padrão": { es: "el predeterminado" },
  padrão: { es: "predeterminado" },
  "de saldo, a mesma do número oficial": { es: "de saldo, la misma del número oficial" },
  "Amazon SES, região": { es: "Amazon SES, región" },
  "E-mail do sistema": { es: "E-mail del sistema" },
  "Convite, senha e LGPD continuam no servidor de e-mail da instalação, sem mudança.": {
    es: "Invitación, contraseña y LGPD siguen en el servidor de e-mail de la instalación, sin cambios.",
  },
  "O envio pela Amazon ainda não foi ligado no servidor.": {
    es: "El envío por Amazon todavía no se activó en el servidor.",
  },
  "Faltam estas variáveis de ambiente:": { es: "Faltan estas variables de entorno:" },
  "Quem coloca as chaves é quem opera a plataforma. Sem elas, nada sai e nada é cobrado.": {
    es: "Quien coloca las claves es quien opera la plataforma. Sin ellas, no sale nada y no se cobra nada.",
  },
  "Saúde do envio · últimos 30 dias": { es: "Salud del envío · últimos 30 días" },
  "Nenhum envio ainda por este domínio. Os números aparecem depois da primeira campanha.": {
    es: "Todavía no hubo envíos por este dominio. Los números aparecen después de la primera campaña.",
  },
  "A trava pausa a campanha em 4%; a Amazon põe a conta em revisão em 5%.": {
    es: "El freno pausa la campaña en 4%; Amazon pone la cuenta en revisión en 5%.",
  },
  "A trava pausa em 0,08%; a Amazon revisa a conta em 0,1%.": {
    es: "El freno pausa en 0,08%; Amazon revisa la cuenta en 0,1%.",
  },
  "endereços na lista de supressão": { es: "direcciones en la lista de supresión" },
  "Ritmo padrão": { es: "Ritmo predeterminado" },
  "E-mails por hora": { es: "E-mails por hora" },
  "por hora": { es: "por hora" },
  "Janela de envio": { es: "Ventana de envío" },
  "Das {a}h às {b}h": { es: "De {a}h a {b}h" },
  "No fuso da empresa. Cada campanha pode ir mais devagar, nunca mais rápido.": {
    es: "En la zona horaria de la empresa. Cada campaña puede ir más despacio, nunca más rápido.",
  },
  "Rodapé com a identificação da empresa": {
    es: "Pie de página con la identificación de la empresa",
  },
  "Por que a pessoa recebe": { es: "Por qué la persona lo recibe" },
  "Política de privacidade": { es: "Política de privacidad" },
  "Sem página própria: usar o texto padrão de privacidade": {
    es: "Sin página propia: usar el texto predeterminado de privacidad",
  },
  "Ele aparece na página de preferências do e-mail.": {
    es: "Aparece en la página de preferencias del e-mail.",
  },
  "Esconder o texto padrão": { es: "Ocultar el texto predeterminado" },
  "Ler o texto padrão": { es: "Leer el texto predeterminado" },
  "Como sai em todo e-mail": { es: "Cómo sale en cada e-mail" },
  Descadastrar: { es: "Darse de baja" },
  "O link de descadastro e o de preferências entram sozinhos e não saem. Rodapé sem razão social, CNPJ, endereço, motivo ou privacidade trava o envio.":
    {
      es: "El enlace de baja y el de preferencias se agregan solos y no se pueden quitar. Un pie de página sin razón social, CNPJ, dirección, motivo o privacidad bloquea el envío.",
    },
  "Domínio verificado. O aquecimento começa no primeiro envio, com até 200 e-mails.": {
    es: "Dominio verificado. El calentamiento empieza en el primer envío, con hasta 200 e-mails.",
  },
  "Conferido. Ainda faltam registros no DNS.": {
    es: "Verificado. Todavía faltan registros en el DNS.",
  },
  "Domínio do remetente": { es: "Dominio del remitente" },
  "Domínio da empresa": { es: "Dominio de la empresa" },
  "o domínio da empresa, sem www": { es: "el dominio de la empresa, sin www" },
  "Subdomínio de retorno": { es: "Subdominio de retorno" },
  "Conferir agora": { es: "Verificar ahora" },
  "Criar e conferir": { es: "Crear y verificar" },
  "Verificado: pode enviar": { es: "Verificado: puedes enviar" },
  "Faltam {n} de 6 registros: o envio fica travado": {
    es: "Faltan {n} de 6 registros: el envío queda bloqueado",
  },
  "Copiar os seis registros": { es: "Copiar los seis registros" },
  "Para que serve": { es: "Para qué sirve" },
  "Copiar o valor": { es: "Copiar el valor" },
  "Aguardando DNS": { es: "Esperando el DNS" },
  "O DMARC ainda não apareceu. O erro mais comum é digitar o nome inteiro no painel do DNS, que já acrescenta o domínio. No campo nome, vai só _dmarc.":
    {
      es: "El DMARC todavía no apareció. El error más común es escribir el nombre completo en el panel del DNS, que ya agrega el dominio. En el campo nombre va solo _dmarc.",
    },
  "Conferido em": { es: "Verificado el" },
  "Os registros vão no DNS de quem cuida do domínio (Registro.br, Cloudflare, GoDaddy). A Amazon confere sozinha de hora em hora; o botão confere na hora. Endereço de provedor gratuito não serve de remetente.":
    {
      es: "Los registros van en el DNS de quien gestiona el dominio (Registro.br, Cloudflare, GoDaddy). Amazon verifica sola cada hora; el botón verifica al instante. Una dirección de proveedor gratuito no sirve como remitente.",
    },
  'Remetente e "responder para"': { es: 'Remitente y "responder a"' },
  "Nenhum remetente ainda.": { es: "Todavía no hay remitentes." },
  "Remetente salvo. Ele usa o mesmo domínio verificado.": {
    es: "Remitente guardado. Usa el mismo dominio verificado.",
  },
  "Acrescentar remetente": { es: "Agregar remitente" },
  'Começa com o "responder para" da marca da empresa (Configurações › Sua empresa › Marca).': {
    es: 'Empieza con el "responder a" de la marca de la empresa (Configuración › Tu empresa › Marca).',
  },
  "Aquecimento do domínio": { es: "Calentamiento del dominio" },
  "Aquecimento do domínio:": { es: "Calentamiento del dominio:" },
  "Aquecimento concluído: vale a cota da conta na Amazon.": {
    es: "Calentamiento concluido: vale la cuota de la cuenta en Amazon.",
  },
  "Domínio novo. O primeiro dia de envio pode até 200 e-mails.": {
    es: "Dominio nuevo. El primer día de envío admite hasta 200 e-mails.",
  },
  "{n} dias de envio feitos. O próximo dia pode até {m} e-mails.": {
    es: "{n} días de envío hechos. El próximo día admite hasta {m} e-mails.",
  },
  "Os 14 degraus do aquecimento": { es: "Los 14 escalones del calentamiento" },
  "Conta só dia com envio. O degrau só sobe se o dia anterior teve rejeição abaixo de 2% e reclamação abaixo de 0,1%; se passar, o degrau se repete. Depois do 14º dia, vale a cota da conta.":
    {
      es: "Solo cuentan los días con envío. El escalón solo sube si el día anterior tuvo rechazo por debajo del 2% y reclamo por debajo del 0,1%; si se pasa, el escalón se repite. Después del día 14, vale la cuota de la cuenta.",
    },
  "Lista de supressão": { es: "Lista de supresión" },
  "Buscar pelo endereço": { es: "Buscar por la dirección" },
  "Nenhum endereço com esse filtro.": { es: "Ninguna dirección con ese filtro." },
  "Acrescentar à mão": { es: "Agregar a mano" },
  "Pedido por telefone": { es: "Pedido por teléfono" },
  "Pedido por WhatsApp": { es: "Pedido por WhatsApp" },
  "A pessoa saiu da empresa cliente": { es: "La persona dejó la empresa cliente" },
  "Endereço acrescentado à supressão.": { es: "Dirección agregada a la supresión." },
  "Esse endereço já está na lista.": { es: "Esa dirección ya está en la lista." },
  "Importar da ferramenta anterior": { es: "Importar de la herramienta anterior" },
  "{a} acrescentados, {b} já estavam, {c} recusados.": {
    es: "{a} agregados, {b} ya estaban, {c} rechazados.",
  },
  "Quem está aqui não recebe e-mail de marketing de novo, em nenhuma campanha. Ninguém tira um endereço daqui pela tela: só a própria pessoa, pelo link do e-mail. Anonimizar o contato apaga o endereço legível e mantém o veto.":
    {
      es: "Quien está aquí no vuelve a recibir e-mail de marketing en ninguna campaña. Nadie quita una dirección de aquí desde la pantalla: solo la propia persona, por el enlace del e-mail. Anonimizar el contacto borra la dirección legible y mantiene el veto.",
    },
  "Textos de consentimento": { es: "Textos de consentimiento" },
  "Com aviso de medição": { es: "Con aviso de medición" },
  "Sem aviso de medição": { es: "Sin aviso de medición" },
  "Rascunho para revisão jurídica": { es: "Borrador para revisión jurídica" },
  "Nova versão do texto": { es: "Nueva versión del texto" },
  "Texto aceito": { es: "Texto aceptado" },
  "O texto avisa que aberturas e cliques são medidos": {
    es: "El texto avisa que se miden aperturas y clics",
  },
  "Versão salva.": { es: "Versión guardada." },
  "Salvar versão": { es: "Guardar versión" },
  "Versão não se edita: o aceite antigo continua apontando para o texto que a pessoa leu.": {
    es: "La versión no se edita: la aceptación antigua sigue apuntando al texto que la persona leyó.",
  },
  "Importar aceites": { es: "Importar aceptaciones" },
  "Uma linha por aceite: e-mail; data do aceite; origem; versão do texto (opcional). Linha sem data ou sem origem é recusada: lista comprada não entra como consentimento.":
    {
      es: "Una línea por aceptación: e-mail; fecha de la aceptación; origen; versión del texto (opcional). La línea sin fecha o sin origen se rechaza: una lista comprada no entra como consentimiento.",
    },
  "ana@example.com;2026-08-12;Formulário do site;padrao-v1": {
    es: "ana@example.com;2026-08-12;Formulario del sitio;padrao-v1",
  },
  Aceites: { es: "Aceptaciones" },
  "{a} lidas, {b} gravadas, {c} já estavam, {d} já tinham saído da lista, {e} recusadas.": {
    es: "{a} leídas, {b} guardadas, {c} ya estaban, {d} ya habían salido de la lista, {e} rechazadas.",
  },
  "Importar {n} linhas": { es: "Importar {n} líneas" },

  // ── os recursos opcionais (lib/recursos-opcionais/catalogo.ts) ──
  "Envio de e-mail marketing pela Amazon": { es: "Envío de e-mail marketing por Amazon" },
  "O caminho por onde saem as campanhas de e-mail das empresas que contrataram o disparo. O e-mail do sistema (convite, senha, LGPD) continua no servidor de e-mail.":
    {
      es: "El camino por donde salen las campañas de e-mail de las empresas que contrataron el envío. El e-mail del sistema (invitación, contraseña, LGPD) sigue en el servidor de e-mail.",
    },
  "No arquivo de ambiente, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY, AWS_SES_CONFIGURATION_SET e AWS_SES_SNS_TOPIC_ARN (região sa-east-1). Passo a passo em docs/fork/email-marketing.md.":
    {
      es: "En el archivo de entorno, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY, AWS_SES_CONFIGURATION_SET y AWS_SES_SNS_TOPIC_ARN (región sa-east-1). Paso a paso en docs/fork/email-marketing.md.",
    },
  "Disparo de e-mail marketing": { es: "Envío de e-mail marketing" },
  "Campanhas de e-mail pelo domínio da empresa, com descadastro de um clique e lista de supressão. A plataforma libera o módulo; a empresa configura o domínio, o remetente e o rodapé.":
    {
      es: "Campañas de e-mail desde el dominio de la empresa, con baja en un clic y lista de supresión. La plataforma habilita el módulo; la empresa configura el dominio, el remitente y el pie de página.",
    },

  // ── o caminho E-mail no Broadcast ──
  "Pelo domínio da empresa, só para quem tem base legal. Cada e-mail aceito é cobrado do seu crédito.":
    {
      es: "Desde el dominio de la empresa, solo para quien tiene base legal. Cada e-mail aceptado se cobra de tu crédito.",
    },
  "por e-mail": { es: "por e-mail" },
  "O número por QR não foi contratado para esta empresa.": {
    es: "El número por QR no fue contratado para esta empresa.",
  },
  enviados: { es: "enviados" },
  "Pelo domínio da empresa, com descadastro de um clique.": {
    es: "Desde el dominio de la empresa, con baja en un clic.",
  },
  "Só para quem tem base legal: consentimento registrado, ou cliente dos últimos 24 meses.": {
    es: "Solo para quien tiene base legal: consentimiento registrado o cliente de los últimos 24 meses.",
  },
  "Sai no ritmo e no aquecimento do domínio, com plano dia a dia.": {
    es: "Sale al ritmo y con el calentamiento del dominio, con un plan día a día.",
  },
  "por e-mail aceito, do seu crédito": { es: "por e-mail aceptado, de tu crédito" },
  "Novidades de novembro": { es: "Novedades de noviembre" },
  "Começar de um segmento salvo (opcional)": {
    es: "Empezar desde un segmento guardado (opcional)",
  },
  "Criar o rascunho": { es: "Crear el borrador" },
  "Usar o e-mail": { es: "Usar el e-mail" },

  // ── a campanha: o cabeçalho e os controles ──
  "Não consegui carregar a campanha.": { es: "No pude cargar la campaña." },
  "Montada pela implantação": { es: "Armada por la implementación" },
  "Envio pausado. Quem ainda não recebeu fica na fila.": {
    es: "Envío pausado. Quien todavía no recibió queda en la cola.",
  },
  "A trava parou o envio. Retomar agora arrisca a conta da Amazon, que é uma só para todas as empresas. Retomar mesmo assim?":
    {
      es: "El freno detuvo el envío. Reanudar ahora pone en riesgo la cuenta de Amazon, que es una sola para todas las empresas. ¿Reanudar de todos modos?",
    },
  "Envio retomado.": { es: "Envío reanudado." },
  "Cancelar o agendamento? A campanha volta a rascunho. Nada saiu e nada foi cobrado.": {
    es: "¿Cancelar la programación? La campaña vuelve a borrador. No salió nada y no se cobró nada.",
  },
  "Encerrar a campanha? Quem ainda não recebeu fica de fora.": {
    es: "¿Terminar la campaña? Quien todavía no recibió queda afuera.",
  },
  "O envio pela Amazon ainda não foi ligado no servidor: dá para montar a campanha, e nada sai até as chaves entrarem.":
    {
      es: "El envío por Amazon todavía no se activó en el servidor: puedes armar la campaña, y no sale nada hasta que se carguen las claves.",
    },

  // ── a campanha: Público ──
  Recorte: { es: "Segmentación" },
  "Tem alguma etiqueta": { es: "Tiene alguna etiqueta" },
  "Não tem a etiqueta": { es: "No tiene la etiqueta" },
  "Qualquer uma, ou nenhuma": { es: "Cualquiera, o ninguna" },
  "Só quem tem empresa": { es: "Solo quien tiene empresa" },
  "Só quem não tem empresa": { es: "Solo quien no tiene empresa" },
  "Sem interação há quantos dias": { es: "Sin interacción hace cuántos días" },
  "Campanha de e-mail anterior": { es: "Campaña de e-mail anterior" },
  "Etiqueta, funil e etapa são o filtro das Campanhas. Os critérios somam como E.": {
    es: "Etiqueta, embudo y etapa son el filtro de las Campañas. Los criterios se suman como Y.",
  },
  "Base legal da campanha": { es: "Base legal de la campaña" },
  Consentimento: { es: "Consentimiento" },
  "Interesse legítimo": { es: "Interés legítimo" },
  "Interesse legítimo (clientes)": { es: "Interés legítimo (clientes)" },
  "Recebe só quem tem o aceite de e-mail marketing registrado na ficha: data, origem e o texto aceito. É o padrão.":
    {
      es: "Recibe solo quien tiene la aceptación de e-mail marketing registrada en la ficha: fecha, origen y el texto aceptado. Es lo predeterminado.",
    },
  "Recebe só quem comprou nos últimos 24 meses, mesmo sem aceite registrado. Exige a referência da avaliação de interesse legítimo, e esses e-mails saem sem medição de abertura.":
    {
      es: "Recibe solo quien compró en los últimos 24 meses, aun sin aceptación registrada. Exige la referencia de la evaluación de interés legítimo, y esos e-mails salen sin medición de apertura.",
    },
  "Mesma regra das Campanhas: interesse legítimo sem a referência não sai.": {
    es: "Misma regla de las Campañas: el interés legítimo sin la referencia no sale.",
  },
  "Segmentos salvos": { es: "Segmentos guardados" },
  "Nenhum segmento salvo ainda.": { es: "Todavía no hay segmentos guardados." },
  "Segmento carregado. A conta foi refeita agora.": {
    es: "Segmento cargado. El conteo se rehízo ahora.",
  },
  "O segmento guarda o filtro, não a lista: a conta refaz na hora de usar, e serve ao WhatsApp e ao e-mail.":
    {
      es: "El segmento guarda el filtro, no la lista: el conteo se rehace al usarlo, y sirve para WhatsApp y para e-mail.",
    },
  "Quem recebe": { es: "Quién recibe" },
  'Escolha pelo menos um critério. Não existe "todos os contatos": recorte sem critério é o envio que ninguém confere antes de apertar.':
    {
      es: 'Elige al menos un criterio. No existe "todos los contactos": una segmentación sin criterio es el envío que nadie revisa antes de presionar.',
    },
  "recebem este e-mail": { es: "reciben este e-mail" },
  "no recorte": { es: "en la segmentación" },
  "O recorte passou do teto de 50 mil contatos: divida a campanha.": {
    es: "La segmentación superó el tope de 50 mil contactos: divide la campaña.",
  },
  "Falta a referência da avaliação de interesse legítimo. Sem ela, a campanha não sai.": {
    es: "Falta la referencia de la evaluación de interés legítimo. Sin ella, la campaña no sale.",
  },
  "sem e-mail": { es: "sin e-mail" },
  "A mesma conta roda de novo antes de cada e-mail sair: quem se descadastrar depois de agendado não recebe.":
    {
      es: "El mismo conteo vuelve a correr antes de que salga cada e-mail: quien se dé de baja después de programado no recibe.",
    },
  "Nome do segmento": { es: "Nombre del segmento" },
  "Segmento salvo.": { es: "Segmento guardado." },
  "Salvar como segmento": { es: "Guardar como segmento" },
  "Salvar e seguir para a mensagem": { es: "Guardar y seguir al mensaje" },
  "Seguir para a mensagem": { es: "Seguir al mensaje" },

  // ── a campanha: Mensagem ──
  "Clique antes no campo onde a variável deve entrar.": {
    es: "Haz clic antes en el campo donde debe ir la variable.",
  },
  "Mensagem salva.": { es: "Mensaje guardado." },
  "Mensagem salva": { es: "Mensaje guardado" },
  "Não consegui enviar a imagem.": { es: "No pude enviar la imagen." },
  "Imagem enviada.": { es: "Imagen enviada." },
  "Escreva pelo menos um endereço.": { es: "Escribe al menos una dirección." },
  "O teste vai para no máximo 5 endereços.": { es: "La prueba va a un máximo de 5 direcciones." },
  "Teste enviado para {n} endereço(s), com [TESTE] no assunto. Não cobrou crédito.": {
    es: "Prueba enviada a {n} dirección(es), con [TESTE] en el asunto. No se cobró crédito.",
  },
  "O teste não saiu para nenhum endereço.": { es: "La prueba no salió para ninguna dirección." },
  "Esta campanha já está agendada e o conteúdo fica congelado. Para mudar, cancele o agendamento.":
    {
      es: "Esta campaña ya está programada y el contenido queda congelado. Para cambiarlo, cancela la programación.",
    },
  "Esta campanha já saiu: o que foi enviado não muda.": {
    es: "Esta campaña ya salió: lo que se envió no cambia.",
  },
  "Cabeçalho do e-mail": { es: "Encabezado del e-mail" },
  "Cadastre um remetente na configuração": { es: "Registra un remitente en la configuración" },
  "Responder para:": { es: "Responder a:" },
  "o próprio remetente": { es: "el propio remitente" },
  "{n} de 60 caracteres": { es: "{n} de 60 caracteres" },
  "Pré-cabeçalho, o texto que aparece depois do assunto na caixa de entrada": {
    es: "Preencabezado, el texto que aparece después del asunto en la bandeja de entrada",
  },
  "{n} de 90 caracteres": { es: "{n} de 90 caracteres" },
  "Campos do CRM": { es: "Campos del CRM" },
  "Clique no campo de texto e depois na variável. É o mesmo vocabulário do Inbox e das Campanhas.":
    {
      es: "Haz clic en el campo de texto y después en la variable. Es el mismo vocabulario del Inbox y de las Campañas.",
    },
  "Texto reserva quando faltar o dado": { es: "Texto de reserva cuando falte el dato" },
  "vazio: quem não tem o dado fica de fora": { es: "vacío: quien no tiene el dato queda afuera" },
  "Texto reserva": { es: "Texto de reserva" },
  "Corpo em blocos": { es: "Cuerpo en bloques" },
  "Tirar o bloco": { es: "Quitar el bloque" },
  "Texto do título": { es: "Texto del título" },
  "Endereço do botão": { es: "Dirección del botón" },
  "Escolher a imagem": { es: "Elegir la imagen" },
  "Texto alternativo: o que a imagem mostra": { es: "Texto alternativo: lo que muestra la imagen" },
  "Texto alternativo da imagem": { es: "Texto alternativo de la imagen" },
  "PNG, JPEG ou GIF, até 1 MB.": { es: "PNG, JPEG o GIF, hasta 1 MB." },
  "Uma linha fina separando as partes.": { es: "Una línea fina que separa las partes." },
  Acrescentar: { es: "Agregar" },
  "O rodapé vem da configuração: razão social, CNPJ, endereço, por que a pessoa recebe, e os links de descadastro e preferências, que não saem.":
    {
      es: "El pie de página viene de la configuración: razón social, CNPJ, dirección, por qué la persona lo recibe, y los enlaces de baja y de preferencias, que no se pueden quitar.",
    },
  "Salvar a mensagem": { es: "Guardar el mensaje" },
  Aparelho: { es: "Dispositivo" },
  Computador: { es: "Computadora" },
  "Ver como": { es: "Ver como" },
  "Contato de exemplo": { es: "Contacto de ejemplo" },
  "Contato sem nome cadastrado": { es: "Contacto sin nombre registrado" },
  "(sem assunto)": { es: "(sin asunto)" },
  "Prévia do e-mail": { es: "Vista previa del e-mail" },
  "Sem texto reserva para {lista}: quem não tem o dado fica de fora.": {
    es: "Sin texto de reserva para {lista}: quien no tiene el dato queda afuera.",
  },
  "Antes de enviar": { es: "Antes de enviar" },
  "Salve a mensagem para a conferência ler a versão nova.": {
    es: "Guarda el mensaje para que la revisión lea la versión nueva.",
  },
  ok: { es: "ok" },
  aviso: { es: "aviso" },
  trava: { es: "bloqueo" },
  "Envio de teste": { es: "Envío de prueba" },
  "Para até 5 endereços, separados por vírgula": {
    es: "Para hasta 5 direcciones, separadas por coma",
  },
  atual: { es: "actual" },
  "Sai pelo mesmo caminho da campanha, com [TESTE] no assunto, e não cobra crédito. Na empresa de demonstração, nada sai de verdade.":
    {
      es: "Sale por el mismo camino de la campaña, con [TESTE] en el asunto, y no cobra crédito. En la empresa de demostración, no sale nada de verdad.",
    },
  Divisor: { es: "Divisor" },

  // ── a conferência da mensagem (FRASES_DA_CONFERENCIA) ──
  "Falta o assunto": { es: "Falta el asunto" },
  "Sem assunto, o envio fica travado.": { es: "Sin asunto, el envío queda bloqueado." },
  "Assunto com {n} caracteres": { es: "Asunto con {n} caracteres" },
  "No celular aparecem uns 40. Vale encurtar.": {
    es: "En el celular aparecen unos 40. Conviene acortarlo.",
  },
  "Pré-cabeçalho longo": { es: "Preencabezado largo" },
  "Passa de {n} caracteres e a caixa corta.": {
    es: "Supera los {n} caracteres y la bandeja lo corta.",
  },
  "Pré-cabeçalho preenchido": { es: "Preencabezado completado" },
  "Sem pré-cabeçalho": { es: "Sin preencabezado" },
  "A caixa de entrada mostra o começo do texto no lugar.": {
    es: "La bandeja de entrada muestra el comienzo del texto en su lugar.",
  },
  "Descadastro de um clique": { es: "Baja en un clic" },
  "No cabeçalho do e-mail (botão do Gmail e da Apple) e no rodapé. Colocado pelo sistema, não sai.":
    {
      es: "En el encabezado del e-mail (botón de Gmail y de Apple) y en el pie de página. Lo coloca el sistema y no se puede quitar.",
    },
  "Rodapé incompleto": { es: "Pie de página incompleto" },
  "Falta razão social, CNPJ, endereço, motivo ou privacidade na configuração.": {
    es: "Falta razón social, CNPJ, dirección, motivo o privacidad en la configuración.",
  },
  "Botões sem endereço válido: {n}": { es: "Botones sin dirección válida: {n}" },
  "Use um endereço que comece com https://.": { es: "Usa una dirección que empiece con https://." },
  "Botões com endereço válido: {n}": { es: "Botones con dirección válida: {n}" },
  "Os cliques são medidos por um link de passagem.": {
    es: "Los clics se miden con un enlace de paso.",
  },
  "Blocos de imagem sem imagem: {n}": { es: "Bloques de imagen sin imagen: {n}" },
  "Escolha a imagem ou tire o bloco.": { es: "Elige la imagen o quita el bloque." },
  "Imagens sem texto alternativo: {n}": { es: "Imágenes sin texto alternativo: {n}" },
  "Muita gente lê com imagem bloqueada.": { es: "Mucha gente lee con las imágenes bloqueadas." },
  "Imagens com texto alternativo": { es: "Imágenes con texto alternativo" },
  "Contatos que ficam de fora por falta de dado: {n}": {
    es: "Contactos que quedan afuera por falta de dato: {n}",
  },
  "Sem texto reserva para {lista}. Preencha a reserva ou aceite a perda.": {
    es: "Sin texto de reserva para {lista}. Completa la reserva o acepta la pérdida.",
  },
  "Variáveis com texto reserva": { es: "Variables con texto de reserva" },
  "Cerca de {n} KB": { es: "Cerca de {n} KB" },
  "O Gmail corta e-mails acima de {lista} KB.": {
    es: "Gmail corta los e-mails de más de {lista} KB.",
  },
  "Abaixo do corte de {lista} KB do Gmail.": { es: "Por debajo del corte de {lista} KB de Gmail." },
  "Teste enviado depois da última mudança": { es: "Prueba enviada después del último cambio" },
  "O conteúdo mudou depois do último teste": {
    es: "El contenido cambió después de la última prueba",
  },
  "Nenhum teste enviado": { es: "No se envió ninguna prueba" },
  "O envio só libera com um teste da versão atual.": {
    es: "El envío solo se habilita con una prueba de la versión actual.",
  },

  // ── a campanha: Enviar ──
  "Sem plano: ninguém entra na lista.": { es: "Sin plan: nadie entra en la lista." },
  "E-mails": { es: "E-mails" },
  "O que limita": { es: "Qué lo limita" },
  "degrau {n} de 14": { es: "escalón {n} de 14" },
  "Envio confirmado": { es: "Envío confirmado" },
  "Começou na confirmação.": { es: "Empezó con la confirmación." },
  "Pessoas na lista:": { es: "Personas en la lista:" },
  "Custo previsto:": { es: "Costo previsto:" },
  "O débito sai do crédito por lote enviado, só pelo que a Amazon aceitou.": {
    es: "El débito sale del crédito por lote enviado, solo por lo que Amazon aceptó.",
  },
  "Declaração de base legal": { es: "Declaración de base legal" },
  "Plano dia a dia": { es: "Plan día a día" },
  "Declaro que estas pessoas são clientes com compra nos últimos 24 meses, conforme a avaliação de interesse legítimo indicada, e que a campanha tem relação com o que compraram.":
    {
      es: "Declaro que estas personas son clientes con compra en los últimos 24 meses, según la evaluación de interés legítimo indicada, y que la campaña tiene relación con lo que compraron.",
    },
  "Declaro que estas pessoas deram o aceite de e-mail marketing registrado no sistema, e que nenhuma lista comprada ou de terceiros entrou aqui.":
    {
      es: "Declaro que estas personas dieron la aceptación de e-mail marketing registrada en el sistema, y que ninguna lista comprada o de terceros entró aquí.",
    },
  "Quando sai": { es: "Cuándo sale" },
  "Começar agora": { es: "Empezar ahora" },
  "Data e hora de início": { es: "Fecha y hora de inicio" },
  "Fora da janela de envio, começa na próxima abertura da janela.": {
    es: "Fuera de la ventana de envío, empieza en la próxima apertura de la ventana.",
  },
  "Ritmo por hora": { es: "Ritmo por hora" },
  "Nunca acima do ritmo da configuração da empresa.": {
    es: "Nunca por encima del ritmo de la configuración de la empresa.",
  },
  "Só em dias úteis": { es: "Solo en días hábiles" },
  concluído: { es: "concluido" },
  "Calculando o plano…": { es: "Calculando el plan…" },
  "Escolha a data e a hora para ver o plano.": { es: "Elige la fecha y la hora para ver el plan." },
  "O domínio novo sobe de degrau só quando o dia anterior fica abaixo de 2% de rejeição e 0,1% de reclamação. Acima disso, o degrau fica parado.":
    {
      es: "El dominio nuevo sube de escalón solo cuando el día anterior queda por debajo del 2% de rechazo y del 0,1% de reclamo. Por encima de eso, el escalón queda detenido.",
    },
  "Custo e crédito": { es: "Costo y crédito" },
  "Faltam {valor}. Com o saldo de hoje cabem {n} e-mails.": {
    es: "Faltan {valor}. Con el saldo de hoy caben {n} e-mails.",
  },
  "Ver o crédito": { es: "Ver el crédito" },
  "Cobra só o e-mail que a Amazon aceitou. O teste não cobra. O saldo é conferido de novo quando o envio começa.":
    {
      es: "Solo cobra el e-mail que Amazon aceptó. La prueba no cobra. El saldo se vuelve a verificar cuando empieza el envío.",
    },
  "Medição: cliques, e abertura só de quem aceitou a medição.": {
    es: "Medición: clics, y apertura solo de quien aceptó la medición.",
  },
  "Medição: só cliques. Interesse legítimo não leva o pixel de abertura.": {
    es: "Medición: solo clics. El interés legítimo no lleva el píxel de apertura.",
  },
  "Calculando…": { es: "Calculando…" },
  "O que falta para enviar": { es: "Qué falta para enviar" },
  "Pronto para enviar": { es: "Listo para enviar" },
  "Nada trava o envio.": { es: "Nada bloquea el envío." },
  Resolver: { es: "Resolver" },
  "Revisar e agendar": { es: "Revisar y programar" },
  "Confirmar o envio": { es: "Confirmar el envío" },
  "Sai a partir de agora para {n} pessoas, no plano acima.": {
    es: "Sale a partir de ahora para {n} personas, según el plan de arriba.",
  },
  "Agendado para {data}, para {n} pessoas, no plano acima.": {
    es: "Programado para {data}, para {n} personas, según el plan de arriba.",
  },
  "A declaração fica gravada na campanha, com o seu nome e a hora.": {
    es: "La declaración queda guardada en la campaña, con tu nombre y la hora.",
  },
  "Envio confirmado. Os primeiros e-mails saem na próxima rodada.": {
    es: "Envío confirmado. Los primeros e-mails salen en la próxima ronda.",
  },
  "Envio agendado.": { es: "Envío programado." },
  "Há uma trava no envio.": { es: "Hay un bloqueo en el envío." },
  // o que limita o dia do plano (ROTULO_DO_LIMITE_DO_DIA)
  "acaba a lista": { es: "se termina la lista" },
  "teto do aquecimento": { es: "tope del calentamiento" },
  "ritmo e janela": { es: "ritmo y ventana" },
  // o que trava o envio (ROTULO_DA_TRAVA)
  "O módulo de e-mail marketing não está contratado.": {
    es: "El módulo de e-mail marketing no está contratado.",
  },
  "O domínio do remetente ainda não está verificado.": {
    es: "El dominio del remitente todavía no está verificado.",
  },
  "O rodapé está incompleto.": { es: "El pie de página está incompleto." },
  "Falta cadastrar um remetente.": { es: "Falta registrar un remitente." },
  "Ninguém entra na lista.": { es: "Nadie entra en la lista." },
  "Interesse legítimo pede a referência da avaliação (LIA).": {
    es: "El interés legítimo pide la referencia de la evaluación (LIA).",
  },
  "Falta o assunto.": { es: "Falta el asunto." },
  "Há botão sem endereço válido.": { es: "Hay un botón sin dirección válida." },
  "Há bloco de imagem sem imagem.": { es: "Hay un bloque de imagen sin imagen." },
  "Envie um teste da versão atual.": { es: "Envía una prueba de la versión actual." },
  "A data do agendamento já passou.": { es: "La fecha de la programación ya pasó." },
  "O crédito não cobre a lista.": { es: "El crédito no cubre la lista." },

  // ── a campanha: Resultados ──
  "trava em": { es: "bloqueo en" },
  "Clicaram em": { es: "Hicieron clic en" },
  "Os resultados aparecem quando a campanha começar a sair.": {
    es: "Los resultados aparecen cuando la campaña empiece a salir.",
  },
  "Não consegui carregar os resultados.": { es: "No pude cargar los resultados." },
  "Segmento salvo. Ele aparece no Público da próxima campanha.": {
    es: "Segmento guardado. Aparece en el Público de la próxima campaña.",
  },
  "{criados} criados, {pulados} pulados.": { es: "{criados} creados, {pulados} omitidos." },
  "{n} ainda na fila": { es: "{n} todavía en la cola" },
  "Aberturas (estimativa)": { es: "Aperturas (estimación)" },
  "Sem medição de abertura": { es: "Sin medición de apertura" },
  "de {n} com medição": { es: "de {n} con medición" },
  "Cliques únicos": { es: "Clics únicos" },
  "{n} cliques no total": { es: "{n} clics en total" },
  Descadastros: { es: "Bajas" },
  Rejeições: { es: "Rechazos" },
  "{n} permanentes": { es: "{n} permanentes" },
  "Reclamações de spam": { es: "Reclamos de spam" },
  Cobrado: { es: "Cobrado" },
  "{n} ficaram de fora na confirmação": { es: "{n} quedaron afuera en la confirmación" },
  "Interesse legítimo: a campanha não leva o pixel de abertura. Só os cliques são medidos.": {
    es: "Interés legítimo: la campaña no lleva el píxel de apertura. Solo se miden los clics.",
  },
  "A abertura é estimativa: alguns programas de e-mail abrem a imagem sozinhos, e só conta quem aceitou a medição. O clique é o número firme.":
    {
      es: "La apertura es una estimación: algunos programas de e-mail abren la imagen solos, y solo cuenta quien aceptó la medición. El clic es el número firme.",
    },
  "Falhas de envio, sem cobrança:": { es: "Fallas de envío, sin cobro:" },
  "Saúde desta campanha": { es: "Salud de esta campaña" },
  Rejeição: { es: "Rechazo" },
  Reclamação: { es: "Reclamo" },
  "A trava pausa o envio sozinha a partir de 300 entregues, para proteger a conta da Amazon, que é uma só para todas as empresas.":
    {
      es: "El freno pausa el envío solo a partir de 300 entregados, para proteger la cuenta de Amazon, que es una sola para todas las empresas.",
    },
  "Cliques por link": { es: "Clics por enlace" },
  "A mensagem não tem botão.": { es: "El mensaje no tiene botón." },
  Botão: { es: "Botón" },
  Destino: { es: "Destino" },
  "Clique no primeiro minuto depois da entrega, ou de programa que confere link, não conta.": {
    es: "El clic en el primer minuto después de la entrega, o de un programa que verifica enlaces, no cuenta.",
  },
  "Quem clicou": { es: "Quién hizo clic" },
  "Ninguém clicou ainda.": { es: "Nadie hizo clic todavía." },
  "Salvar segmento": { es: "Guardar segmento" },
  "Tarefa para o responsável": { es: "Tarea para el responsable" },
  "Ligar para quem clicou": { es: "Llamar a quien hizo clic" },
  "Criar {n} tarefas": { es: "Crear {n} tareas" },
  "Sem responsável no contato, a tarefa fica com você.": {
    es: "Si el contacto no tiene responsable, la tarea queda contigo.",
  },
  "Abrir {n} negócios": { es: "Abrir {n} negocios" },
  "Quem já tem negócio aberto no funil é pulado.": {
    es: "Quien ya tiene un negocio abierto en el embudo se omite.",
  },
  "Negócio aberto": { es: "Negocio abierto" },
  sim: { es: "sí" },
  não: { es: "no" },
  "Mostrando os 200 primeiros.": { es: "Mostrando los 200 primeros." },

  // ── os comportamentos na campanha anterior (ROTULO_DO_COMPORTAMENTO) ──
  Clicou: { es: "Hizo clic" },
  "Abriu (estimativa)": { es: "Abrió (estimación)" },
  "Recebeu e não abriu": { es: "Recibió y no abrió" },
  Recebeu: { es: "Recibió" },

  // ── por que um contato fica de fora (ROTULO_DO_MOTIVO e PORQUE_DO_MOTIVO) ──
  "Descadastrou do e-mail": { es: "Se dio de baja del e-mail" },
  "Marcou como spam": { es: "Lo marcó como spam" },
  "Pediu à equipe para sair": { es: "Pidió al equipo salir" },
  "Outros vetos do CRM": { es: "Otros vetos del CRM" },
  "Sem e-mail no cadastro": { es: "Sin e-mail en el registro" },
  "Rejeição permanente": { es: "Rechazo permanente" },
  "Sem consentimento registrado": { es: "Sin consentimiento registrado" },
  "Não é cliente": { es: "No es cliente" },
  "E-mail repetido": { es: "E-mail repetido" },
  "Pediu para sair pelo link do rodapé, pelo botão do Gmail ou pela página de preferências.": {
    es: "Pidió salir por el enlace del pie de página, por el botón de Gmail o por la página de preferencias.",
  },
  "Reclamação que o provedor devolve. Nunca mais recebe.": {
    es: "Reclamo que devuelve el proveedor. No vuelve a recibir nunca.",
  },
  "Recusa registrada à mão, com quem registrou e quando.": {
    es: "Rechazo registrado a mano, con quién lo registró y cuándo.",
  },
  "Pediu para parar no WhatsApp, recusou marketing, contato pessoal ou anonimizado. São as regras das Campanhas.":
    {
      es: "Pidió parar en WhatsApp, rechazó marketing, es contacto personal o está anonimizado. Son las reglas de las Campañas.",
    },
  "Não há endereço para mandar.": { es: "No hay dirección a la cual enviar." },
  "O endereço não tem forma de e-mail ou o domínio não recebe e-mail. A conferência roda antes do envio.":
    {
      es: "La dirección no tiene forma de e-mail o el dominio no recibe e-mail. La verificación corre antes del envío.",
    },
  "Um envio anterior voltou porque o endereço não existe.": {
    es: "Un envío anterior volvió porque la dirección no existe.",
  },
  "Nunca aceitou receber e-mail de marketing, ou o aceite não está no sistema.": {
    es: "Nunca aceptó recibir e-mail de marketing, o la aceptación no está en el sistema.",
  },
  "Interesse legítimo vale só para quem comprou nos últimos 24 meses.": {
    es: "El interés legítimo vale solo para quien compró en los últimos 24 meses.",
  },
  "Mesmo endereço de outro contato da lista: recebe uma vez só.": {
    es: "La misma dirección que otro contacto de la lista: recibe una sola vez.",
  },

  // ── por que a campanha parou (ROTULO_DA_PAUSA) e a supressão (ROTULO_DA_SUPRESSAO) ──
  "Pausada: o crédito acabou. Recarregue e retome.": {
    es: "Pausada: se acabó el crédito. Recarga y reanuda.",
  },
  "Pausada: esta é a empresa de demonstração, e nada sai daqui.": {
    es: "Pausada: esta es la empresa de demostración, y no sale nada de aquí.",
  },
  "Pausada: o envio pela Amazon foi desligado no servidor.": {
    es: "Pausada: el envío por Amazon se desactivó en el servidor.",
  },
  "Pausada: o domínio deixou de estar verificado.": {
    es: "Pausada: el dominio dejó de estar verificado.",
  },
  "Pausada: a Amazon pausou o envio da conta.": {
    es: "Pausada: Amazon pausó el envío de la cuenta.",
  },
  Descadastro: { es: "Baja" },
  "Pedido à equipe": { es: "Pedido al equipo" },
  Importada: { es: "Importada" },

  // ── as variáveis do e-mail (VARIAVEIS_DO_EMAIL) ──
  "Primeiro nome": { es: "Primer nombre" },
  "Bom dia, boa tarde ou boa noite": { es: "Buenos días, buenas tardes o buenas noches" },
  "Empresa do contato": { es: "Empresa del contacto" },
  "Responsável pelo contato": { es: "Responsable del contacto" },
  "Campo do contato: cidade": { es: "Campo del contacto: ciudad" },

  // ── o consentimento na ficha do contato ──
  "Aceite registrado.": { es: "Aceptación registrada." },
  "pedido à equipe": { es: "pedido al equipo" },
  "Recusa registrada. O endereço entrou na lista de supressão.": {
    es: "Rechazo registrado. La dirección entró en la lista de supresión.",
  },
  "Na lista de supressão": { es: "En la lista de supresión" },
  "Aceite vigente": { es: "Aceptación vigente" },
  "Sem aceite": { es: "Sin aceptación" },
  "Recusou marketing no WhatsApp": { es: "Rechazó marketing en WhatsApp" },
  "O contato não tem e-mail cadastrado.": { es: "El contacto no tiene e-mail registrado." },
  "Não recebe e-mail marketing. Só a própria pessoa volta, pelo link de um e-mail.": {
    es: "No recibe e-mail marketing. Solo la propia persona vuelve, por el enlace de un e-mail.",
  },
  "Aceite em": { es: "Aceptación el" },
  "Versão do texto": { es: "Versión del texto" },
  "Medição de abertura": { es: "Medición de apertura" },
  aceita: { es: "aceptada" },
  "não aceita": { es: "no aceptada" },
  Evidência: { es: "Evidencia" },
  "Registrar aceite": { es: "Registrar aceptación" },
  "Registrar recusa": { es: "Registrar rechazo" },
  "De onde veio o aceite": { es: "De dónde vino la aceptación" },
  "Formulário do site, balcão, ligação": { es: "Formulario del sitio, mostrador, llamada" },
  "Data do aceite": { es: "Fecha de la aceptación" },
  "Texto que a pessoa aceitou": { es: "Texto que la persona aceptó" },
  "com medição": { es: "con medición" },
  "sem medição": { es: "sin medición" },
  "Evidência (obrigatória)": { es: "Evidencia (obligatoria)" },
  "Onde está a prova: o link do formulário, o protocolo da ligação, a foto da ficha assinada": {
    es: "Dónde está la prueba: el enlace del formulario, el número de la llamada, la foto de la ficha firmada",
  },
  "Gravar o aceite": { es: "Guardar la aceptación" },
  "A pessoa pediu para não receber e-mail marketing. O endereço entra na lista de supressão agora, e só ela volta, pelo link de um e-mail.":
    {
      es: "La persona pidió no recibir e-mail marketing. La dirección entra ahora en la lista de supresión, y solo ella vuelve, por el enlace de un e-mail.",
    },
  "Por onde ela pediu": { es: "Por dónde lo pidió" },
  "WhatsApp, ligação, balcão": { es: "WhatsApp, llamada, mostrador" },
  "Gravar a recusa": { es: "Guardar el rechazo" },
  "Esconder o histórico": { es: "Ocultar el historial" },
  "Ver o histórico ({n})": { es: "Ver el historial ({n})" },
  Aceite: { es: "Aceptación" },
  Recusa: { es: "Rechazo" },
  // quem fez o registro (ROTULO_DO_REGISTRO)
  "na ficha": { es: "en la ficha" },
  "por importação": { es: "por importación" },
  "pela própria pessoa": { es: "por la propia persona" },
  "pela implantação": { es: "por la implementación" },

  // ── a página pública de preferências ──
  "Preferências de e-mail": { es: "Preferencias de e-mail" },
  "Abra o link para ver as suas preferências.": { es: "Abre el enlace para ver tus preferencias." },
  "Use o link de um e-mail mais recente. Se quiser sair da lista, responda a qualquer e-mail pedindo.":
    {
      es: "Usa el enlace de un e-mail más reciente. Si quieres salir de la lista, responde a cualquier e-mail pidiéndolo.",
    },
  "Muitas tentativas. Aguarde um minuto.": { es: "Demasiados intentos. Espera un minuto." },
  "Não deu certo agora. Tente de novo em alguns minutos.": {
    es: "No funcionó ahora. Inténtalo de nuevo en unos minutos.",
  },
  "Este é um e-mail de teste: a página mostra o que a pessoa veria, e nada do que você escolher aqui é gravado.":
    {
      es: "Este es un e-mail de prueba: la página muestra lo que la persona vería, y nada de lo que elijas aquí se guarda.",
    },
  Seções: { es: "Secciones" },
  Preferências: { es: "Preferencias" },
  Privacidade: { es: "Privacidad" },
  "A política de privacidade de {empresa} está em:": {
    es: "La política de privacidad de {empresa} está en:",
  },
  "Modo de teste: nada foi gravado.": { es: "Modo de prueba: no se guardó nada." },
  "Pronto: você não recebe mais e-mails de marketing desta empresa.": {
    es: "Listo: ya no recibes e-mails de marketing de esta empresa.",
  },
  "Pronto: você volta a receber os e-mails desta empresa.": {
    es: "Listo: vuelves a recibir los e-mails de esta empresa.",
  },
  "Você não recebe e-mails de marketing desta empresa": {
    es: "No recibes e-mails de marketing de esta empresa",
  },
  "Pedidos, agendamentos e atendimento continuam chegando normalmente.": {
    es: "Pedidos, citas y atención siguen llegando normalmente.",
  },
  "Gravando…": { es: "Guardando…" },
  "Voltar a receber": { es: "Volver a recibir" },
  "Este endereço não pode voltar a receber, porque as mensagens não chegaram até ele.": {
    es: "Esta dirección no puede volver a recibir, porque los mensajes no llegaron hasta ella.",
  },
  "Sair da lista de e-mails": { es: "Salir de la lista de e-mails" },
  "Você recebe os e-mails de marketing desta empresa": {
    es: "Recibes los e-mails de marketing de esta empresa",
  },
  "Ao sair, você deixa de receber novidades e ofertas por e-mail. Pedidos, agendamentos e atendimento continuam chegando normalmente.":
    {
      es: "Al salir, dejas de recibir novedades y ofertas por e-mail. Pedidos, citas y atención siguen llegando normalmente.",
    },
  "Você já não recebe mensagens de marketing pelo WhatsApp.": {
    es: "Ya no recibes mensajes de marketing por WhatsApp.",
  },
  "Também não quero receber mensagens de marketing pelo WhatsApp.": {
    es: "Tampoco quiero recibir mensajes de marketing por WhatsApp.",
  },
  "Quer contar por quê? (opcional)": { es: "¿Quieres contar por qué? (opcional)" },
  "Recebo e-mails demais": { es: "Recibo demasiados e-mails" },
  "O assunto não me interessa mais": { es: "El tema ya no me interesa" },
  "Não me lembro de ter pedido": { es: "No recuerdo haberlo pedido" },
  "Sair da lista": { es: "Salir de la lista" },
  // o aviso de privacidade padrão (TEXTO_PADRAO_DE_PRIVACIDADE), RASCUNHO PARA REVISÃO JURÍDICA
  "Como a {empresa} usa o seu e-mail": { es: "Cómo {empresa} usa tu e-mail" },
  "Usamos o seu endereço de e-mail para mandar novidades, ofertas e convites da {empresa}, com base no seu consentimento ou, se você é nosso cliente, no nosso interesse legítimo de manter contato sobre o que você já comprou.":
    {
      es: "Usamos tu dirección de e-mail para enviar novedades, ofertas e invitaciones de {empresa}, con base en tu consentimiento o, si eres nuestro cliente, en nuestro interés legítimo de mantener contacto sobre lo que ya compraste.",
    },
  "Quando você aceitou a medição, registramos se o e-mail foi aberto e em quais links você clicou. Essa medição é uma estimativa: alguns programas de e-mail abrem as imagens sozinhos e outros as bloqueiam.":
    {
      es: "Cuando aceptaste la medición, registramos si el e-mail se abrió y en qué enlaces hiciste clic. Esa medición es una estimación: algunos programas de e-mail abren las imágenes solos y otros las bloquean.",
    },
  "Os e-mails são enviados por um serviço de envio contratado pela {empresa}, que só os usa para entregar a mensagem.":
    {
      es: "Los e-mails se envían por un servicio de envío contratado por {empresa}, que solo los usa para entregar el mensaje.",
    },
  "Você pode sair da lista a qualquer momento, pelo link de descadastro de qualquer e-mail ou por esta página. Pedidos, agendamentos e atendimento continuam chegando normalmente.":
    {
      es: "Puedes salir de la lista en cualquier momento, por el enlace de baja de cualquier e-mail o por esta página. Pedidos, citas y atención siguen llegando normalmente.",
    },
  "Guardamos o registro do seu aceite ou da sua recusa (data, origem e texto) enquanto a {empresa} mantiver o cadastro, para poder provar que respeitou a sua escolha. Se você pedir a exclusão dos seus dados, o seu endereço deixa de ser legível e fica guardado só um código que impede que ele volte a receber.":
    {
      es: "Guardamos el registro de tu aceptación o de tu rechazo (fecha, origen y texto) mientras {empresa} mantenga el registro, para poder probar que respetó tu elección. Si pides la eliminación de tus datos, tu dirección deja de ser legible y queda guardado solo un código que impide que vuelva a recibir.",
    },
  "Para exercer os seus direitos previstos na Lei Geral de Proteção de Dados (acesso, correção, exclusão, revogação do consentimento), fale com a {empresa} pelos canais de atendimento.":
    {
      es: "Para ejercer tus derechos previstos en la Ley General de Protección de Datos (acceso, corrección, eliminación, revocación del consentimiento), habla con {empresa} por los canales de atención.",
    },
};
