"""Catalogos SAT para CFDI 4.0 — semilla por tenant (CP2 · D3).

Sigue el principio D1 (multitenant, nada hardcodeado): estos valores son solo
la SEMILLA con la que arranca un tenant nuevo. Una vez sembrados viven en
`AdminConfig` bajo las claves `catalog.sat_*` y el admin del tenant los edita
desde la pantalla de Configuracion (D3), que ya sabe manejar cualquier clave
`catalog.*` con un editor JSON generico.

Es un SUBCONJUNTO deliberado de los catalogos oficiales del SAT — los codigos
que un punto de venta de materiales usa de verdad. No es el catalogo completo
(c_ClaveProdServ solo tiene ~50 mil renglones); si un tenant necesita mas,
los agrega desde Configuracion sin tocar codigo.

Referencia: Anexo 20 RMF (CFDI 4.0), catalogos c_UsoCFDI, c_FormaPago,
c_MetodoPago, c_RegimenFiscal, c_ClaveUnidad, c_ObjetoImp.
"""
from __future__ import annotations

import models

# Prefijo de las claves en AdminConfig
PREFIX = "catalog.sat_"

# c_UsoCFDI — para que usara el receptor el comprobante
USO_CFDI = [
    {"code": "G01", "label": "Adquisición de mercancías"},
    {"code": "G02", "label": "Devoluciones, descuentos o bonificaciones"},
    {"code": "G03", "label": "Gastos en general"},
    {"code": "I01", "label": "Construcciones"},
    {"code": "I02", "label": "Mobiliario y equipo de oficina por inversiones"},
    {"code": "I03", "label": "Equipo de transporte"},
    {"code": "I08", "label": "Otra maquinaria y equipo"},
    {"code": "D01", "label": "Honorarios médicos, dentales y gastos hospitalarios"},
    {"code": "D10", "label": "Pagos por servicios educativos (colegiaturas)"},
    {"code": "S01", "label": "Sin efectos fiscales"},
    {"code": "CP01", "label": "Pagos"},
]

# c_FormaPago — con que se pago
FORMA_PAGO = [
    {"code": "01", "label": "Efectivo"},
    {"code": "02", "label": "Cheque nominativo"},
    {"code": "03", "label": "Transferencia electrónica de fondos"},
    {"code": "04", "label": "Tarjeta de crédito"},
    {"code": "28", "label": "Tarjeta de débito"},
    {"code": "99", "label": "Por definir"},
]

# c_MetodoPago — en una exhibicion o en parcialidades
METODO_PAGO = [
    {"code": "PUE", "label": "Pago en una sola exhibición"},
    {"code": "PPD", "label": "Pago en parcialidades o diferido"},
]

# c_RegimenFiscal — del emisor y del receptor
REGIMEN_FISCAL = [
    {"code": "601", "label": "General de Ley Personas Morales"},
    {"code": "603", "label": "Personas Morales con Fines no Lucrativos"},
    {"code": "605", "label": "Sueldos y Salarios e Ingresos Asimilados a Salarios"},
    {"code": "606", "label": "Arrendamiento"},
    {"code": "612", "label": "Personas Físicas con Actividades Empresariales y Profesionales"},
    {"code": "616", "label": "Sin obligaciones fiscales"},
    {"code": "621", "label": "Incorporación Fiscal"},
    {"code": "625", "label": "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas"},
    {"code": "626", "label": "Régimen Simplificado de Confianza (RESICO)"},
]

# c_ClaveUnidad — unidades de medida oficiales del SAT (Anexo 20 CFDI 4.0) con uso común y sinónimos coloquiales
UNIDADES = [
    {"code": "H87", "label": "Pieza", "category": "Venta individual, artículos por unidad, tramos, botellas", "keywords": "pieza pza unidad individual articulo tramo tira botella garrafon envase"},
    {"code": "MTR", "label": "Metro", "category": "Venta longitudinal, tramos, tiras, cables, tubos, perfiles", "keywords": "metro lineal mtr tramo tira longitud"},
    {"code": "KGM", "label": "Kilogramo", "category": "Venta por peso, alambre, clavo, varilla por kilo, granel", "keywords": "kilo kilogramo kg peso granel"},
    {"code": "LTR", "label": "Litro", "category": "Líquidos, pinturas, solventes, agua, botellas, envases", "keywords": "litro lt liquido botella garrafon envase pintura solvente agua"},
    {"code": "TNE", "label": "Tonelada métrica", "category": "Acero estructural, varilla, cemento por mayoreo", "keywords": "tonelada ton metrica acero cemento"},
    {"code": "MTQ", "label": "Metro cúbico", "category": "Volumen, arena, grava, concreto, agregados (m³)", "keywords": "metro cubico m3 volumen arena grava concreto"},
    {"code": "MTK", "label": "Metro cuadrado", "category": "Superficie, pisos, azulejos, losetas, mallas (m²)", "keywords": "metro cuadrado m2 superficie piso azulejo loseta"},
    {"code": "XBX", "label": "Caja", "category": "Empaque cerrado de compra o venta por mayoreo", "keywords": "caja empaque carton master"},
    {"code": "XPK", "label": "Paquete", "category": "Empaque múltiple, blíster o paquete cerrado", "keywords": "paquete pack paq blister"},
    {"code": "XSA", "label": "Saco", "category": "Cemento, mortero, cal, yeso, bultos y costales", "keywords": "saco bulto costal cemento mortero cal yeso"},
    {"code": "XBG", "label": "Bolsa", "category": "Pegazulejo, boquilla, bolsas plásticas, bultos", "keywords": "bolsa bulto costal saco empaque"},
    {"code": "XBH", "label": "Atado / Manojo", "category": "Atados de varilla, perfiles, alambre o madera", "keywords": "atado manojo mazo fardo varilla"},
    {"code": "XRO", "label": "Rollo", "category": "Mallas, cables eléctricos, mangueras, alambre", "keywords": "rollo malla cable manguera alambre poliducto"},
    {"code": "XBJ", "label": "Cubeta", "category": "Pinturas, impermeabilizantes y químicos en cubeta 19L", "keywords": "cubeta balde bote tambor 19l"},
    {"code": "XBO", "label": "Botella", "category": "Agua embotellada, líquidos envasados, garrafones", "keywords": "botella garrafon envase porron liquido"},
    {"code": "GLL", "label": "Galón", "category": "Pinturas, esmaltes, solventes y selladores (3.785 L)", "keywords": "galon pintura impermeabilizante esmalte"},
    {"code": "SET", "label": "Conjunto", "category": "Juegos de herramientas, kits, autocles y accesorios", "keywords": "conjunto juego kit set herramientas"},
    {"code": "PR",  "label": "Par", "category": "Guantes, botas de seguridad, bisagras, correderas", "keywords": "par pareja guantes botas"},
    {"code": "MIL", "label": "Millar", "category": "Ladrillos, tabiques, tornillería o clavos por millar", "keywords": "millar mil 1000 ladrillo tabique"},
    {"code": "E48", "label": "Unidad de servicio", "category": "Fletes, maniobras, instalaciones y mano de obra", "keywords": "servicio flete envio mano de obra maniobra"},
    {"code": "ACT", "label": "Actividad", "category": "Servicios generales y reparaciones", "keywords": "actividad servicio instalacion"},
    {"code": "GRM", "label": "Gramo", "category": "Pesos menores, soldadura, químicos", "keywords": "gramo gr"},
    {"code": "CMT", "label": "Centímetro", "category": "Medida longitudinal corta", "keywords": "centimetro cm"},
    {"code": "INH", "label": "Pulgada", "category": "Medida anglosajona (tubería, tornillería)", "keywords": "pulgada in"},
    {"code": "FOT", "label": "Pie", "category": "Madera, tablas y perfiles por pie", "keywords": "pie ft tabla madera"},
]

# c_ClaveProdServ — Catálogo oficial del SAT (Anexo 20 CFDI 4.0) con Jerarquía Padre (División > Grupo)
PROD_SERV = [
    # ── ALIMENTOS, BEBIDAS, AGUA EMBOTELLADA Y ABARROTES (División 50) ──
    {"code": "50202301", "label": "Agua embotellada", "category": "Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas", "unit": "H87", "keywords": "agua purificada embotellada garrafon botella mineral natural bonafont ciel epura litro"},
    {"code": "50202300", "label": "Bebidas no alcohólicas", "category": "Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas", "unit": "H87", "keywords": "bebida no alcoholica liquido hidratante"},
    {"code": "50202306", "label": "Refrescos o bebidas carbonatadas", "category": "Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas", "unit": "H87", "keywords": "refresco soda gaseosa coca pepsi lata botella"},
    {"code": "50202309", "label": "Bebidas energéticas o deportivas hidratantes", "category": "Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas", "unit": "H87", "keywords": "bebida energetica isotonica electrolitos suero gatorade powerade"},
    {"code": "50202304", "label": "Jugos o néctares de frutas", "category": "Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas", "unit": "H87", "keywords": "jugo nectar fruta concentrado"},
    {"code": "50201700", "label": "Café y té", "category": "Alimentos, Bebidas y Tabaco > Café y té", "unit": "H87", "keywords": "cafe soluble grano molido te infusiones"},
    {"code": "50192100", "label": "Botanas, papas fritas y frituras", "category": "Alimentos, Bebidas y Tabaco > Botanas y snacks", "unit": "H87", "keywords": "botana papas fritas frituras cacahuates chicharrones"},
    {"code": "50161800", "label": "Productos de confitería, dulces y chocolates", "category": "Alimentos, Bebidas y Tabaco > Dulces y chocolates", "unit": "H87", "keywords": "dulce caramelo chocolate paleta chicle gomita"},
    {"code": "50181900", "label": "Pan, galletas y pastelillos dulces", "category": "Alimentos, Bebidas y Tabaco > Panadería y galletas", "unit": "H87", "keywords": "galleta pan pastelito barra cereal"},
    {"code": "50131700", "label": "Leche y productos lácteos", "category": "Alimentos, Bebidas y Tabaco > Lácteos y huevo", "unit": "LTR", "keywords": "leche deslactosada entera evaporada queso crema yogurt"},
    {"code": "50221100", "label": "Granos, arroz, frijol y semillas", "category": "Alimentos, Bebidas y Tabaco > Cereales y legumbres", "unit": "KGM", "keywords": "arroz frijol maiz lenteja avena semilla"},
    {"code": "50171500", "label": "Aceites comestibles, azúcar, sal y condimentos", "category": "Alimentos, Bebidas y Tabaco > Abarrotes y condimentos", "unit": "H87", "keywords": "aceite vegetal cocina azucar sal salsa mayonesa"},

    # ── HERRAMIENTAS MANUALES Y ELÉCTRICAS (División 27) ──
    {"code": "27111600", "label": "Martillos", "category": "Herramientas y Maquinaria > Herramientas manuales", "unit": "H87", "keywords": "martillo martillos golpe herramienta"},
    {"code": "27111602", "label": "Martillos de uña o de carpintero", "category": "Herramientas y Maquinaria > Herramientas manuales", "unit": "H87", "keywords": "martillo una carpintero chivo 16oz 20oz truper"},
    {"code": "27111603", "label": "Mazos o marros", "category": "Herramientas y Maquinaria > Herramientas manuales", "unit": "H87", "keywords": "mazo marro marros demolicion octogonal"},
    {"code": "27111604", "label": "Martillos de bola", "category": "Herramientas y Maquinaria > Herramientas manuales", "unit": "H87", "keywords": "martillo bola mecanico herrero"},
    {"code": "27111605", "label": "Martillos de goma o hule", "category": "Herramientas y Maquinaria > Herramientas manuales", "unit": "H87", "keywords": "martillo goma hule mazo azulejero"},
    {"code": "27111618", "label": "Martillos demoledores o cinceladores", "category": "Herramientas y Maquinaria > Herramientas eléctricas", "unit": "H87", "keywords": "martillo demoledor rotomartillo cincelador"},
    {"code": "27111500", "label": "Herramientas de corte, cinceles, navajas y cutters", "category": "Herramientas y Maquinaria > Herramientas de corte", "unit": "H87", "keywords": "cincel punzon cortafrio cutter navaja cuchilla tijera exacto"},
    {"code": "27111700", "label": "Llaves inglesas y drivers (llaves, desarmadores, dados)", "category": "Herramientas y Maquinaria > Llaves y desarmadores", "unit": "H87", "keywords": "llave llaves espanola combinada stilson perico matraca dado"},
    {"code": "27111701", "label": "Desarmadores o destornilladores", "category": "Herramientas y Maquinaria > Llaves y desarmadores", "unit": "H87", "keywords": "desarmador destornillador plano cruz phillips"},
    {"code": "27111704", "label": "Llaves ajustables (pericos y llaves stilson)", "category": "Herramientas y Maquinaria > Llaves y desarmadores", "unit": "H87", "keywords": "llave ajustable perico stilson plomero"},
    {"code": "27111708", "label": "Llaves Allen o hexagonales", "category": "Herramientas y Maquinaria > Llaves y desarmadores", "unit": "H87", "keywords": "llave allen hexagonal torx"},
    {"code": "27112100", "label": "Pinzas, alicates y tenazas", "category": "Herramientas y Maquinaria > Sujeción y pinzas", "unit": "H87", "keywords": "pinza pinzas alicate electricista chofer presion corte"},
    {"code": "27111800", "label": "Herramientas de medición y trazado (flexómetros, niveles)", "category": "Herramientas y Maquinaria > Medición y nivelación", "unit": "H87", "keywords": "flexometro cinta metrica nivel escuadra plomada vernier"},
    {"code": "27111801", "label": "Cintas métricas o flexómetros", "category": "Herramientas y Maquinaria > Medición y nivelación", "unit": "H87", "keywords": "flexometro cinta metrica metro medir"},
    {"code": "27111802", "label": "Niveles de burbuja o láser", "category": "Herramientas y Maquinaria > Medición y nivelación", "unit": "H87", "keywords": "nivel niveles burbuja aluminio laser"},
    {"code": "27111900", "label": "Limas, escofinas y piedras de afilar", "category": "Herramientas y Maquinaria > Desbaste y limas", "unit": "H87", "keywords": "lima escofina bastarda triangulo afilar"},
    {"code": "27112000", "label": "Herramientas de jardinería, palas, picos y azadones", "category": "Herramientas y Maquinaria > Jardinería y excavación", "unit": "H87", "keywords": "pala pico zapapico azadon rastrillo machete cava"},
    {"code": "27112001", "label": "Palas cuadradas o redondas", "category": "Herramientas y Maquinaria > Jardinería y excavación", "unit": "H87", "keywords": "pala cuadrada carbonera redonda"},
    {"code": "27112004", "label": "Picos y zapapicos", "category": "Herramientas y Maquinaria > Jardinería y excavación", "unit": "H87", "keywords": "pico zapapico talacho"},
    {"code": "27112200", "label": "Herramientas de albañilería y concreto (cucharas, llanas, flotas)", "category": "Herramientas y Maquinaria > Albañilería", "unit": "H87", "keywords": "cuchara albanil llana flota espatula"},
    {"code": "27112300", "label": "Sierras manuales, seguetas y serruchos", "category": "Herramientas y Maquinaria > Herramientas de corte", "unit": "H87", "keywords": "sierra segueta serrucho arco"},
    {"code": "27112700", "label": "Herramientas eléctricas portátiles (taladros, esmeriladoras, sierras)", "category": "Herramientas y Maquinaria > Herramientas eléctricas", "unit": "H87", "keywords": "taladro rotomartillo esmeriladora pulidora sierra circular caladora"},
    {"code": "27112701", "label": "Taladros y rotomartillos eléctricos o inalámbricos", "category": "Herramientas y Maquinaria > Herramientas eléctricas", "unit": "H87", "keywords": "taladro rotomartillo atornillador inalambrico"},
    {"code": "27112703", "label": "Esmeriladoras angulares y pulidoras", "category": "Herramientas y Maquinaria > Herramientas eléctricas", "unit": "H87", "keywords": "esmeril esmeriladora pulidora miniesmeriladora"},
    {"code": "27112800", "label": "Brocas, discos de corte, discos abrasivos y lijas", "category": "Herramientas y Maquinaria > Brocas y abrasivos", "unit": "H87", "keywords": "broca brocas disco corte desbaste diamante lija"},
    {"code": "27113200", "label": "Juegos y kits de herramientas", "category": "Herramientas y Maquinaria > Juegos de herramientas", "unit": "KT", "keywords": "juego herramientas kit autocle caja herramientas"},

    # ── ACEROS, VARILLAS, PERFILES, LÁMINAS Y MALLAS (División 30) ──
    {"code": "30101800", "label": "Perfiles de acero y varillas de refuerzo", "category": "Materiales de Construcción > Acero estructural y perfiles", "unit": "H87", "keywords": "varilla corrugada perfil acero refuerzo ptr polin monten"},
    {"code": "30102400", "label": "Varillas de acero corrugadas y barras macizas", "category": "Materiales de Construcción > Acero estructural y varillas", "unit": "H87", "keywords": "varilla corrugada alambron barra redondo cuadrado macizo"},
    {"code": "30102402", "label": "Varilla corrugada de acero para refuerzo de concreto", "category": "Materiales de Construcción > Acero estructural y varillas", "unit": "KGM", "keywords": "varilla corrugada refuerzo 3/8 1/2 5/8 3/4 deacero sicartsa"},
    {"code": "30101500", "label": "Ángulos de acero y soleras estructurales", "category": "Materiales de Construcción > Acero estructural y perfiles", "unit": "H87", "keywords": "angulo solera perfil acero estructural"},
    {"code": "30101700", "label": "Vigas de acero (IPR, IPS, canales)", "category": "Materiales de Construcción > Acero estructural y perfiles", "unit": "H87", "keywords": "viga ipr ips canal monten polin"},
    {"code": "30102000", "label": "Láminas y placas de acero (galvanizada, negra, acanalada)", "category": "Materiales de Construcción > Láminas y placas metálicas", "unit": "H87", "keywords": "lamina galvanizada zintro acanalada placa acero"},
    {"code": "30102200", "label": "Alambre recocido, alambre galvanizado y alambre de púas", "category": "Materiales de Construcción > Alambres y mallas", "unit": "KGM", "keywords": "alambre recocido galvanizado puas amarre"},
    {"code": "30102300", "label": "Perfiles tubulares de acero (PTR, tubo cuadrado y rectangular)", "category": "Materiales de Construcción > Acero estructural y perfiles", "unit": "H87", "keywords": "ptr perfil tubular cuadrado rectangular"},
    {"code": "30103600", "label": "Malla electrosoldada, malla ciclónica y tela gallinera", "category": "Materiales de Construcción > Alambres y mallas", "unit": "XRO", "keywords": "malla electrosoldada ciclonica criba harnero"},
    {"code": "30103604", "label": "Castillos prefabricados electrosoldados (Armex)", "category": "Materiales de Construcción > Alambres y mallas", "unit": "H87", "keywords": "armex castillo electrosoldado escalerilla"},

    # ── CEMENTO, MORTERO, CONCRETO, AGREGADOS Y BLOQUES (División 30) ──
    {"code": "30111600", "label": "Cemento, cal y yeso", "category": "Materiales de Construcción > Cemento, cal y concreto", "unit": "XBG", "keywords": "cemento gris blanco mortero cal yeso cemex apasco moctezuma"},
    {"code": "30111601", "label": "Cemento Portland (gris o blanco)", "category": "Materiales de Construcción > Cemento, cal y concreto", "unit": "XBG", "keywords": "cemento portland gris blanco bulto saco 50kg tolteca cruz azul"},
    {"code": "30111602", "label": "Cal hidratada para construcción", "category": "Materiales de Construcción > Cemento, cal y concreto", "unit": "XBG", "keywords": "cal hidratada bulto saco calidra"},
    {"code": "30111700", "label": "Yeso, estuco y pastas para muros", "category": "Materiales de Construcción > Cemento, cal y concreto", "unit": "XBG", "keywords": "yeso estuco recubrimiento pasta muro"},
    {"code": "30111500", "label": "Concreto premezclado y morteros preparados", "category": "Materiales de Construcción > Cemento, cal y concreto", "unit": "XBG", "keywords": "concreto mortero mezcla bulto"},
    {"code": "30111800", "label": "Agregados pétreos (arena, grava, piedra triturada, tezontle)", "category": "Materiales de Construcción > Áridos y agregados", "unit": "MTQ", "keywords": "arena grava sello tezontle piedra tepetate"},
    {"code": "30131500", "label": "Bloques de concreto, tabiques y ladrillos", "category": "Materiales de Construcción > Bloques y ladrillos", "unit": "H87", "keywords": "block bloque tabique ladrillo tabicon bovedilla"},
    {"code": "30161500", "label": "Paneles de yeso (Tablaroca) y fibrocemento (Durock)", "category": "Materiales de Construcción > Acabados y muros ligeros", "unit": "H87", "keywords": "tablaroca panel yeso durock plafon sheetrock"},

    # ── MADERAS, TRIPLAY Y TECHOS (División 30) ──
    {"code": "30103619", "label": "Madera de pino para construcción (tablas, barrotes, polines)", "category": "Materiales de Construcción > Maderas y cimbra", "unit": "H87", "keywords": "madera tabla polin barrote chaflan duela cimbra pino"},
    {"code": "30102903", "label": "Triplay, madera contrachapada y MDF", "category": "Materiales de Construcción > Maderas y cimbra", "unit": "H87", "keywords": "triplay mdf aglomerado hoja cimbra"},
    {"code": "30151500", "label": "Materiales para techados, láminas e impermeabilizantes", "category": "Materiales de Construcción > Techados y cubiertas", "unit": "H87", "keywords": "lamina techo impermeabilizante teja carton"},

    # ── TORNILLERÍA, CLAVOS, PIJAS Y FIJACIÓN (División 31) ──
    {"code": "31161500", "label": "Tornillos, pijas y birlos", "category": "Componentes de Fabricación > Tornillería y fijación", "unit": "H87", "keywords": "tornillo tornillos pija pijas chilillo birlo tirafondo"},
    {"code": "31161700", "label": "Tuercas y rondanas (arandelas)", "category": "Componentes de Fabricación > Tornillería y fijación", "unit": "H87", "keywords": "tuerca tuercas hexagonal rondana arandela"},
    {"code": "31162000", "label": "Clavos, grapas y tachuelas", "category": "Componentes de Fabricación > Tornillería y fijación", "unit": "KGM", "keywords": "clavo clavos concreto madera grapa tachuela"},
    {"code": "31162100", "label": "Taquetes, anclas y sujetadores de expansión", "category": "Componentes de Fabricación > Tornillería y fijación", "unit": "H87", "keywords": "taquete ancla expansor sujetador plastico"},
    {"code": "31162400", "label": "Bisagras, abrazaderas, correderas y herrajes", "category": "Componentes de Fabricación > Herrajes y cerrajería", "unit": "H87", "keywords": "bisagra abrazadera cincho corredera herraje pasador"},

    # ── PINTURAS, IMPERMEABILIZANTES, ADHESIVOS Y ACABADOS (División 31 / 30) ──
    {"code": "31211500", "label": "Pinturas, esmaltes y recubrimientos (vinílica, acrílica, aerosol)", "category": "Componentes de Fabricación > Pinturas y recubrimientos", "unit": "LTR", "keywords": "pintura vinilica acrilica esmalte aerosol barniz comex berel"},
    {"code": "31211700", "label": "Selladores, primers e impermeabilizantes", "category": "Componentes de Fabricación > Pinturas y recubrimientos", "unit": "LTR", "keywords": "impermeabilizante sellador primer asfaltico fibratado"},
    {"code": "12191600", "label": "Solventes, thinner, aguarrás y diluyentes", "category": "Productos Químicos > Solventes y diluyentes", "unit": "LTR", "keywords": "thiner thinner solvente aguarras acido muriatico"},
    {"code": "31211900", "label": "Brochas, rodillos y accesorios para pintar", "category": "Componentes de Fabricación > Pinturas y recubrimientos", "unit": "H87", "keywords": "brocha rodillo felpa charola pintar"},
    {"code": "31201500", "label": "Cintas adhesivas y selladoras (masking tape, cinta de aislar, teflón)", "category": "Componentes de Fabricación > Adhesivos y selladores", "unit": "H87", "keywords": "cinta masking aislar teflon selladora ducto empaque canela"},
    {"code": "31201600", "label": "Pegamentos, silicón, adhesivos, pegazulejo y resinas", "category": "Componentes de Fabricación > Adhesivos y selladores", "unit": "H87", "keywords": "pegamento silicon adhesivo pegazulejo crest cemento pvc resistol"},
    {"code": "30131600", "label": "Azulejos, losetas, pisos cerámicos y porcelanatos", "category": "Materiales de Construcción > Pisos y recubrimientos cerámicos", "unit": "MTK", "keywords": "piso azulejo loseta porcelanato zoclo ceramico"},

    # ── PLOMERÍA, TUBERÍAS, CONEXIONES, TINACOS Y GRIFERÍA (División 40 / 30) ──
    {"code": "40171500", "label": "Tubos y tuberías comerciales (PVC, CPVC, cobre, galvanizado, PPR)", "category": "Plomería, Calefacción y Tuberías > Tubos y tuberías", "unit": "H87", "keywords": "tubo tuberia pvc cpvc cobre plus ppr galvanizado sanitario hidraulico"},
    {"code": "40141700", "label": "Conexiones y accesorios de plomería (codos, tees, coples, reducciones)", "category": "Plomería, Calefacción y Tuberías > Conexiones de tubería", "unit": "H87", "keywords": "codo tee cople conector reduccion tuerca union niple"},
    {"code": "40141600", "label": "Válvulas, llaves de paso, mezcladoras y grifos", "category": "Plomería, Calefacción y Tuberías > Válvulas y grifería", "unit": "H87", "keywords": "valvula llave paso esfera nariz check flotador mezcladora regadera"},
    {"code": "40142100", "label": "Mangueras de jardín, mangueras alimentadoras y conexiones", "category": "Plomería, Calefacción y Tuberías > Mangueras y conexiones", "unit": "H87", "keywords": "manguera jardin gas coflex alimentadora"},
    {"code": "30181500", "label": "Inodoros, sanitarios, lavabos, tinacos y muebles de baño", "category": "Materiales de Construcción > Instalaciones de baño y tinacos", "unit": "H87", "keywords": "sanitario taza inodoro wc lavabo mingitorio tinaco cisterna rotoplas"},
    {"code": "40151500", "label": "Bombas de agua e hidroneumáticos", "category": "Plomería, Calefacción y Tuberías > Bombas y compresores", "unit": "H87", "keywords": "bomba agua periferica centrifuga sumergible presurizador"},

    # ── MATERIAL ELÉCTRICO, CABLES E ILUMINACIÓN (División 26 / 39) ──
    {"code": "26121600", "label": "Cables eléctricos, alambres de cobre y cordones", "category": "Generación y Distribución Eléctrica > Cables y conductores", "unit": "MTR", "keywords": "cable electrico thw cobre calibre 10 12 14 duplex uso rudo"},
    {"code": "39131700", "label": "Cajas eléctricas (chalupas, registros), poliducto y tubo conduit", "category": "Iluminación y Accesorios Eléctricos > Canalización y cajas eléctricas", "unit": "H87", "keywords": "chalupa caja registro poliducto manguera corrugada conduit canaleta"},
    {"code": "39121400", "label": "Contactos, apagadores, clavijas, placas y extensiones eléctricas", "category": "Iluminación y Accesorios Eléctricos > Dispositivos eléctricos", "unit": "H87", "keywords": "contacto apagador interruptor clavija placa extension multicontacto"},
    {"code": "39121600", "label": "Pastillas termomagnéticas, centros de carga y fusibles", "category": "Iluminación y Accesorios Eléctricos > Protección de circuitos", "unit": "H87", "keywords": "pastilla termomagnetica breaker centro carga interruptor fusible"},
    {"code": "39111500", "label": "Lámparas, focos LED, reflectores y luminarias", "category": "Iluminación y Accesorios Eléctricos > Iluminación y lámparas", "unit": "H87", "keywords": "foco led bulbo lampara reflector luminaria tubo"},

    # ── CERRAJERÍA, SOLDADURA, SEGURIDAD, LIMPIEZA Y OFICINA ──
    {"code": "46171500", "label": "Candados, cerraduras, chapas y cerrojos", "category": "Equipos de Seguridad > Cerrajería y control de acceso", "unit": "H87", "keywords": "candado cerradura chapa cerrojo pasador"},
    {"code": "23271400", "label": "Soldadura, electrodos, microalambre y equipos para soldar", "category": "Maquinaria Industrial > Equipos y suministros de soldadura", "unit": "KGM", "keywords": "soldadura electrodo 6013 7018 microalambre estano cautin"},
    {"code": "46181500", "label": "Equipo de protección personal (guantes, cascos, lentes, botas, chalecos)", "category": "Equipos de Seguridad > Protección personal (EPP)", "unit": "H87", "keywords": "guante guantes carnaza nitrilo casco lentes gafas bota chaleco cubrebocas faja"},
    {"code": "31151500", "label": "Cuerdas, sogas, lazos, rafia y cadenas", "category": "Componentes de Fabricación > Cuerdas, cadenas y cables", "unit": "MTR", "keywords": "cuerda soga lazo rafia cadena eslinga"},
    {"code": "47131600", "label": "Escobas, trapeadores, cepillos y artículos de limpieza", "category": "Equipos y Suministros de Limpieza > Utensilios de limpieza", "unit": "H87", "keywords": "escoba trapeador jalador cepillo cubeta recogedor"},
    {"code": "47131800", "label": "Soluciones de limpieza, cloro, detergentes y desinfectantes", "category": "Equipos y Suministros de Limpieza > Químicos y detergentes de limpieza", "unit": "LTR", "keywords": "cloro limpiador desinfectante detergente jabon pinol fabuloso"},
    {"code": "15121500", "label": "Aceites lubricantes, grasas automotrices y anticongelantes", "category": "Combustibles y Lubricantes > Lubricantes y aceites", "unit": "LTR", "keywords": "aceite motor lubricante grasa afloja todo wd40 anticongelante"},
    {"code": "44121600", "label": "Suministros de papelería y oficina", "category": "Equipos y Suministros de Oficina > Papelería", "unit": "H87", "keywords": "papel hoja libreta cuaderno pluma boligrafo marcador carpeta"},

    # ── SERVICIOS, FLETES Y CLAVE GENÉRICA ──
    {"code": "78101800", "label": "Transporte de carga por carretera (Fletes y envíos)", "category": "Servicios de Transporte y Almacenaje > Transporte de carga", "unit": "E48", "keywords": "flete envio transporte entrega maniobra"},
    {"code": "01010101", "label": "No existe en el catálogo (Clave genérica SAT para público en general)", "category": "Catálogo General SAT > Sin clasificación específica", "unit": "H87", "keywords": "generico general no existe mostrador varios"},
]

# c_ObjetoImp — si el concepto causa impuesto
OBJETO_IMP = [
    {"code": "01", "label": "No objeto de impuesto"},
    {"code": "02", "label": "Sí objeto de impuesto"},
    {"code": "03", "label": "Sí objeto del impuesto y no obligado al desglose"},
]

CLAVE_PROD_SERV_GENERICA = "01010101"
UNIDAD_DEFAULT = "H87"

CATALOGS = {
    "uso_cfdi":    USO_CFDI,
    "forma_pago":  FORMA_PAGO,
    "metodo_pago": METODO_PAGO,
    "regimen":     REGIMEN_FISCAL,
    "unidades":    UNIDADES,
    "prod_serv":   PROD_SERV,
    "objeto_imp":  OBJETO_IMP,
}

FORMA_PAGO_POR_METODO_POS = {
    "001": "01",   # efectivo
    "002": "04",   # tarjeta de credito
    "003": "28",   # tarjeta de debito
    "004": "03",   # transferencia
    "005": "02",   # cheque
    "006": "99",   # credito -> por definir (se define al cobrar)
}

# ── MOTOR SEMÁNTICO MULTICAPA (STOPWORDS + DICCIONARIO DE SINÓNIMOS + REGLAS IA) ──
STOPWORDS_ES = {
    "DE", "DEL", "EL", "LA", "LOS", "LAS", "PARA", "EN", "CON", "SIN", "POR",
    "UN", "UNA", "UNOS", "UNAS", "Y", "O", "U", "A", "AL", "LO", "SU", "SUS",
    "MAS", "TIPO", "USO", "MARCA", "MODELO", "COLOR", "PIEZA", "PIEZAS", "PZA", "PZAS"
}

# Diccionario extensible de sinónimos comerciales / coloquiales -> términos oficiales del SAT
SYNONYMS_DICT = {
    "PURIFICADA": ["AGUA", "EMBOTELLADA", "BEBIDA", "50202301"],
    "EMBOTELLADA": ["AGUA", "BEBIDA", "50202301"],
    "GARRAFON": ["AGUA", "EMBOTELLADA", "50202301"],
    "BONAFONT": ["AGUA", "EMBOTELLADA", "50202301"],
    "CIEL": ["AGUA", "EMBOTELLADA", "50202301"],
    "EPURA": ["AGUA", "EMBOTELLADA", "50202301"],
    "REFRESCO": ["BEBIDA", "CARBONATADA", "50202306"],
    "COCA": ["REFRESCO", "BEBIDA", "CARBONATADA", "50202306"],
    "SODA": ["REFRESCO", "BEBIDA", "CARBONATADA", "50202306"],
    "TABLAROCA": ["PANELES", "YESO", "30161500"],
    "SHEETROCK": ["PANELES", "YESO", "30161500"],
    "DUROCK": ["PANELES", "FIBROCEMENTO", "YESO", "30161500"],
    "TEFLON": ["CINTA", "SELLADORA", "ADHESIVA", "31201500"],
    "MASKING": ["CINTA", "ADHESIVA", "31201500"],
    "CHALUPA": ["CAJA", "ELECTRICA", "REGISTRO", "CONDUIT", "39131700"],
    "POLIDUCTO": ["TUBO", "CONDUIT", "ELECTRICO", "39131700"],
    "PIJA": ["TORNILLO", "FIJACION", "31161500"],
    "PIJAS": ["TORNILLOS", "FIJACION", "31161500"],
    "CHILILLO": ["TORNILLO", "PIJA", "31161500"],
    "RONDANA": ["ARANDELA", "TUERCA", "31161700"],
    "PERICO": ["LLAVE", "AJUSTABLE", "INGLESA", "27111704"],
    "STILSON": ["LLAVE", "AJUSTABLE", "PLOMERO", "27111704"],
    "DESARMADOR": ["DESTORNILLADOR", "LLAVE", "27111701"],
    "CUTTER": ["NAVAJA", "HERRAMIENTA", "CORTE", "27111500"],
    "EXACTO": ["NAVAJA", "HERRAMIENTA", "CORTE", "27111500"],
    "FLEXOMETRO": ["CINTA", "METRICA", "MEDICION", "27111801"],
    "ROTOMARTILLO": ["TALADRO", "MARTILLO", "DEMOLEDOR", "27112701"],
    "ESMERIL": ["ESMERILADORA", "PULIDORA", "27112703"],
    "BUFFER": ["ESMERILADORA", "PULIDORA", "27112703"],
    "ARMEX": ["CASTILLO", "ELECTROSOLDADO", "MALLA", "30103604"],
    "PTR": ["PERFIL", "TUBULAR", "ACERO", "30102300"],
    "MONTEN": ["VIGA", "PERFIL", "ACERO", "30101700"],
    "IPR": ["VIGA", "ACERO", "30101700"],
    "SOLERA": ["ANGULO", "PERFIL", "ACERO", "30101500"],
    "PEGAZULEJO": ["ADHESIVO", "PEGAMENTO", "PISO", "31201600"],
    "CREST": ["ADHESIVO", "PEGAZULEJO", "31201600"],
    "RESISTOL": ["PEGAMENTO", "ADHESIVO", "31201600"],
    "THINNER": ["SOLVENTE", "DILUYENTE", "12191600"],
    "THINER": ["SOLVENTE", "DILUYENTE", "12191600"],
    "AGUARRAS": ["SOLVENTE", "DILUYENTE", "12191600"],
    "ROTOPLAS": ["TINACO", "CISTERNA", "AGUA", "30181500"],
    "TINACO": ["ALMACENAMIENTO", "AGUA", "BAÑO", "30181500"],
    "WC": ["INODORO", "SANITARIO", "BAÑO", "30181500"],
    "TAZA": ["INODORO", "SANITARIO", "BAÑO", "30181500"],
    "BREAKER": ["PASTILLA", "TERMOMAGNETICA", "CENTRO", "CARGA", "39121600"],
    "FOCO": ["LAMPARA", "LED", "ILUMINACION", "39111500"],
    "CLORO": ["LIMPIEZA", "DESINFECTANTE", "47131800"],
    "PINOL": ["LIMPIEZA", "DESINFECTANTE", "47131800"],
    "WD40": ["LUBRICANTE", "ACEITE", "15121500"],
}


def _get(db, empresa_id: str, key: str):
    return (db.query(models.AdminConfig)
              .filter(models.AdminConfig.empresa_id == empresa_id,
                      models.AdminConfig.config_key == key)
              .first())


def get_catalog(db, empresa_id: str, nombre: str, default=None):
    """Lee un catalogo SAT del tenant; si no lo sembró, cae al default del código."""
    row = _get(db, empresa_id, f"{PREFIX}{nombre}")
    val = row.config_val if row else None
    if isinstance(val, list) and val:
        # Combinar catálogo base actualizado con personalizaciones del tenant sin perder las nuevas claves
        base_list = CATALOGS.get(nombre, [])
        if base_list:
            seen = set()
            merged = []
            for item in list(val) + list(base_list):
                if isinstance(item, dict):
                    c = str(item.get("code", "")).upper()
                    if c and c not in seen:
                        seen.add(c)
                        merged.append(item)
            return merged
        return val
    return default if default is not None else CATALOGS.get(nombre, [])


def get_learned_memory(db, empresa_id: str) -> dict:
    row = _get(db, empresa_id, f"{PREFIX}learned_memory")
    if row and isinstance(row.config_val, dict):
        return row.config_val
    return {"by_token": {}, "by_depto": {}, "by_familia": {}}


def record_learned_memory(db, empresa_id: str, *, query_or_desc: str, departamento: str = "",
                          familia: str = "", sat_id: str = "", sat_unidad: str = "H87",
                          updated_by: str = "sistema") -> dict:
    """Guarda en caliente la relación entre palabras/departamento/familia y el SAT ID real validado."""
    import unicodedata
    def _norm(txt: str) -> str:
        s = unicodedata.normalize("NFD", str(txt or "")).encode("ascii", "ignore").decode("ascii")
        return s.strip().upper()

    sat_id_clean = _norm(sat_id)
    sat_un_clean = _norm(sat_unidad) or "H87"
    # Regla Anti-Alucinación: solo memorizar códigos que existan en el catálogo local
    catalog_items = get_catalog(db, empresa_id, "prod_serv")
    valid_codes = {str(it.get("code", "")).upper() for it in catalog_items if isinstance(it, dict)}
    if sat_id_clean not in valid_codes:
        return {"saved": False, "reason": "code_not_in_local_catalog"}

    mem = get_learned_memory(db, empresa_id)
    by_token = dict(mem.get("by_token") or {})
    by_depto = dict(mem.get("by_depto") or {})
    by_familia = dict(mem.get("by_familia") or {})

    entry = {"sat_id": sat_id_clean, "sat_unidad": sat_un_clean}
    depto_norm = _norm(departamento)
    fam_norm = _norm(familia)
    if depto_norm and depto_norm != "GENERAL":
        by_depto[depto_norm] = entry
    if fam_norm and fam_norm != "GENERAL":
        by_familia[fam_norm] = entry

    raw_tokens = [t for t in _norm(query_or_desc).replace(",", " ").replace(".", " ").split() if len(t) >= 3 and t not in STOPWORDS_ES]
    for tok in raw_tokens[:8]:
        by_token[tok] = entry

    new_mem = {"by_token": by_token, "by_depto": by_depto, "by_familia": by_familia}
    key = f"{PREFIX}learned_memory"
    row = _get(db, empresa_id, key)
    if row:
        row.config_val = new_mem
        row.updated_by = updated_by
        db.add(row)
    else:
        db.add(models.AdminConfig(empresa_id=empresa_id, config_key=key,
                                  config_val=new_mem, updated_by=updated_by))
    return {"saved": True, "sat_id": sat_id_clean, "sat_unidad": sat_un_clean}


def semantic_sat_search(db, empresa_id: str, query: str = "", *, kind: str = "prod_serv",
                        departamento: str = "", familia: str = "", limit: int = 20) -> list:
    """Motor de búsqueda inteligente de 3 niveles en cascada con Regla Anti-Alucinación."""
    import unicodedata, re
    def _norm(txt: str) -> str:
        s = unicodedata.normalize("NFD", str(txt or "")).encode("ascii", "ignore").decode("ascii")
        return re.sub(r"[^A-Z0-9\s/]", " ", s.strip().upper())

    catalog_key = "unidades" if kind == "unidades" else "prod_serv"
    items = get_catalog(db, empresa_id, catalog_key)
    if not items:
        items = CATALOGS.get(catalog_key, [])

    q_norm = _norm(query)
    depto_norm = _norm(departamento)
    fam_norm = _norm(familia)
    learned = get_learned_memory(db, empresa_id) if catalog_key == "prod_serv" else {}
    by_token = (learned.get("by_token") or {}) if isinstance(learned, dict) else {}
    by_depto = (learned.get("by_depto") or {}) if isinstance(learned, dict) else {}
    by_familia = (learned.get("by_familia") or {}) if isinstance(learned, dict) else {}

    if not q_norm and not depto_norm and not fam_norm:
        return items[:limit]

    # 1. Tokenización limpiando conectores ("de", "el", "la", "para", "en")
    raw_words = [w for w in q_norm.split() if w]
    base_tokens = [w for w in raw_words if w not in STOPWORDS_ES] or raw_words

    # 2. Expansión con diccionario de sinónimos comerciales / coloquiales
    expanded_tokens = set(base_tokens)
    synonym_target_codes = set()
    for tok in base_tokens:
        for syn_key, syn_vals in SYNONYMS_DICT.items():
            if tok == syn_key or (len(tok) >= 4 and (syn_key.startswith(tok) or tok.startswith(syn_key))):
                for sv in syn_vals:
                    if sv.isdigit() and len(sv) == 8:
                        synonym_target_codes.add(sv)
                    else:
                        expanded_tokens.add(sv)

    # 3. Memoria aprendida de CALEBSYS
    learned_boost_codes = set()
    for tok in base_tokens:
        if tok in by_token and isinstance(by_token[tok], dict):
            learned_boost_codes.add(by_token[tok].get("sat_id", ""))
    if depto_norm in by_depto and isinstance(by_depto[depto_norm], dict):
        learned_boost_codes.add(by_depto[depto_norm].get("sat_id", ""))
    if fam_norm in by_familia and isinstance(by_familia[fam_norm], dict):
        learned_boost_codes.add(by_familia[fam_norm].get("sat_id", ""))

    scored = []
    for it in items:
        if not isinstance(it, dict):
            continue
        code = _norm(it.get("code", "")).replace(" ", "")
        label = _norm(it.get("label", ""))
        cat = _norm(it.get("category", ""))
        kw = _norm(it.get("keywords", ""))
        haystack = f"{code} {label} {cat} {kw}"
        hay_words = set(haystack.split())

        score = 0.0
        matched_base = 0

        # Coincidencia por código numérico directo
        if q_norm and code == q_norm.replace(" ", ""):
            score += 250.0
            matched_base = len(base_tokens)
        elif q_norm and code.startswith(q_norm.replace(" ", "")):
            score += 140.0
            matched_base = len(base_tokens)

        # Coincidencia parcial de tokens base (ej. "agua purificada embotellada" -> coincide "agua" y "embotellada" = 2/3)
        for tok in base_tokens:
            if tok in hay_words:
                matched_base += 1
                if tok in label.split():
                    score += 45.0
                elif tok in kw.split():
                    score += 32.0
                else:
                    score += 20.0
            elif len(tok) >= 4 and tok in haystack:
                matched_base += 1
                score += 25.0

        # Coincidencia por sinónimos expandidos
        for syn_tok in (expanded_tokens - set(base_tokens)):
            if syn_tok in hay_words or (len(syn_tok) >= 4 and syn_tok in haystack):
                score += 28.0

        if code in synonym_target_codes:
            score += 85.0

        if code in learned_boost_codes:
            score += 65.0

        # Bonus por proporción de palabras encontradas (ej. 2 de 3 palabras)
        if base_tokens and matched_base > 0:
            coverage = matched_base / float(len(base_tokens))
            score += coverage * 40.0

        # Contexto de Familia / Departamento cuando se usa el clasificador IA
        if depto_norm and depto_norm != "GENERAL" and depto_norm in haystack:
            score += 18.0
        if fam_norm and fam_norm != "GENERAL" and fam_norm in haystack:
            score += 18.0

        if score > 0:
            item_copy = dict(it)
            item_copy["match_score"] = round(score, 1)
            item_copy["learned"] = (code in learned_boost_codes)
            scored.append((score, item_copy))

    scored.sort(key=lambda x: -x[0])
    return [x[1] for x in scored[:limit]]


def is_valid_code(db, empresa_id: str, nombre: str, code: str) -> bool:
    """Valida un código contra el catálogo del tenant (no contra una constante)."""
    if not code:
        return False
    for row in get_catalog(db, empresa_id, nombre):
        if isinstance(row, dict):
            if str(row.get("code", "")).upper() == str(code).upper():
                return True
        elif str(row).upper() == str(code).upper():
            return True
    return False


def forma_pago_desde_pos(db, empresa_id: str, payment_method: str) -> str:
    """Traduce el payment_method interno del POS a c_FormaPago del SAT."""
    row = _get(db, empresa_id, f"{PREFIX}map_forma_pago")
    mapa = row.config_val if row and isinstance(row.config_val, dict) else None
    mapa = mapa or FORMA_PAGO_POR_METODO_POS
    return mapa.get(str(payment_method or "").strip(), "99")


def seed_sat_catalogs(db, empresa_id: str, *, updated_by: str = "sistema",
                      overwrite: bool = False) -> dict:
    """Siembra los catálogos SAT del tenant en AdminConfig. Idempotente:
    no pisa lo que el admin ya editó salvo que se pida `overwrite`.

    NO hace commit — lo hace el caller dentro de su transacción.
    """
    creados, respetados = [], []
    payload = dict(CATALOGS)
    payload["map_forma_pago"] = FORMA_PAGO_POR_METODO_POS

    for nombre, valor in payload.items():
        key = f"{PREFIX}{nombre}"
        row = _get(db, empresa_id, key)
        if row and not overwrite:
            respetados.append(key)
            continue
        if row:
            row.config_val = valor
            row.updated_by = updated_by
            db.add(row)
        else:
            db.add(models.AdminConfig(empresa_id=empresa_id, config_key=key,
                                      config_val=valor, updated_by=updated_by))
        creados.append(key)
    return {"sembrados": creados, "respetados": respetados}

