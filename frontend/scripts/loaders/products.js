// ============================================================================
// CALEBSYS ERP - Loader de Catálogo de Productos (#productos)
// Accesos rápidos:
//   INS     -> Nuevo Producto
//   ENTER   -> Editar Producto seleccionado
//   DEL     -> Eliminar Producto(s) seleccionado(s) o marcado(s)
//   ESPACIO -> Marcar / Desmarcar producto en la tabla
//   F4      -> Filtro por Familia
//   F5      -> Filtro por Departamento
//   F6      -> Filtro por Marca
//   F7      -> Filtro por Ofertas
//   F8      -> Recuadro de Existencias (Stock) por Sucursal y Almacén
//   F9      -> Sin Filtro (Limpiar todos los filtros)
//   F12     -> Kardex General (Todos los productos o 1 solo | Matriz, Sucursales o Ambas)
// ============================================================================

(function (global) {
    'use strict';

    var _searchTimer = null;
    var _inactivityClearTimer = null;
    var _retainedSearchQuery = '';
    var _masterProducts = [];
    var _allProducts = [];
    var _filtered = [];
    var _selectedSku = null;
    var _checked = new Set();
    var _onlyPromo = false;
    var _keyBound = false;

    // ========================================================================
    // MOTOR DE BÚSQUEDA INTELIGENTE + ORDEN ALFANUMÉRICO NATURAL (0-9, A-Z)
    // ========================================================================
    function _stripAccentsUpper(s) {
        if (!s) return '';
        return String(s)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .trim();
    }

    function _normalizeToken(t) {
        var u = _stripAccentsUpper(t);
        u = u.replace(/^(\d+(?:\.\d+)?)(KGS?|KILOS?|KILOGRAMOS?)$/, '$1K');
        u = u.replace(/^(\d+(?:\.\d+)?)(LTS?|LITROS?)$/, '$1L');
        u = u.replace(/^(\d+(?:\.\d+)?)(MTS?|METROS?)$/, '$1M');
        u = u.replace(/^(\d+(?:\.\d+)?)(GRS?|GRAMOS?)$/, '$1G');
        u = u.replace(/^(\d+(?:\.\d+)?)(PZS?|PIEZAS?|PZA)$/, '$1P');
        return u;
    }

    function _stemToken(t) {
        var u = _normalizeToken(t);
        if (u === 'CEMETO' || u === 'SEMENTO' || u === 'CEMENTOS') return 'CEMENTO';
        if (u.length > 4 && u.slice(-2) === 'ES' && !/\d/.test(u)) return u.slice(0, -2);
        if (u.length > 3 && u.slice(-1) === 'S' && !/\d/.test(u)) return u.slice(0, -1);
        return u;
    }

    function _tokenizeQuery(q) {
        var raw = _stripAccentsUpper(q).replace(/[,;|]+/g, ' ');
        var parts = raw.split(/\s+/).filter(Boolean);
        var merged = [];
        var i = 0;
        while (i < parts.length) {
            var cur = parts[i];
            var nxt = (i + 1 < parts.length) ? parts[i + 1] : '';
            if (/^\d+(?:\.\d+)?$/.test(cur) && /^(K|KG|KGS|KILO|KILOS|KILOGRAMO|KILOGRAMOS|G|GR|GRS|GRAMOS|L|LT|LTS|LITRO|LITROS|M|MT|MTS|METRO|METROS|CM|MM|PZA|PZAS|PZ)$/.test(nxt)) {
                merged.push(_normalizeToken(cur + nxt));
                i += 2;
                continue;
            }
            var m = cur.match(/^(\d+(?:\.\d+)?)(K|KG|KGS|KILO|KILOS|G|GR|GRS|L|LT|LTS|M|MT|MTS|CM|MM|PZA|PZAS|PZ)$/);
            if (m) {
                merged.push(_normalizeToken(cur));
            } else {
                merged.push(cur);
            }
            i += 1;
        }
        return merged;
    }

    function _editDistLe1(a, b) {
        if (a === b) return true;
        var la = a.length, lb = b.length;
        if (Math.abs(la - lb) > 1) return false;
        if (la < 4 && lb < 4) return false;
        var i = 0, j = 0, diffs = 0;
        while (i < la && j < lb) {
            if (a[i] === b[j]) {
                i++; j++;
            } else {
                diffs++;
                if (diffs > 1) return false;
                if (la > lb) i++;
                else if (lb > la) j++;
                else { i++; j++; }
            }
        }
        if (i < la || j < lb) diffs++;
        return diffs <= 1;
    }

    function _buildProductSearchBlob(p) {
        var m = (p && p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var sku = _stripAccentsUpper(p.sku || '');
        var barcode = _stripAccentsUpper(p.barcode || m.codigo_barras || m.barcode || '');
        var barcodeNoZeros = barcode.replace(/^0+/, '');
        var salesCode = _stripAccentsUpper(p.sales_code || m.codigo_alterno || m.sales_code || '');
        var name = _stripAccentsUpper(p.name || '');
        var desc = _stripAccentsUpper(p.description || m.descripcion || '');
        var marca = _stripAccentsUpper(m.marca || m.brand || '');
        var familia = _stripAccentsUpper(m.familia || m.category || '');
        var depto = _stripAccentsUpper(m.departamento || '');
        var obs = _stripAccentsUpper(m.observaciones || '');
        var ref = _stripAccentsUpper(m.referencia || m.referencias || m.modelo || '');
        var prov = _stripAccentsUpper(m.proveedor || '');
        var unit = _stripAccentsUpper(p.sale_unit || '');
        var satId = _stripAccentsUpper(m.sat_id || m.clave_sat || '');

        var baseText = [sku, barcode, barcodeNoZeros, salesCode, name, desc, marca, familia, depto, obs, ref, prov, unit, satId].filter(Boolean).join(' ');
        // Expandir variantes de peso/medida (ej. "50 KG" -> "50K 50KG 50 K 50 KG")
        var expanded = baseText.replace(/(\d+(?:\.\d+)?)\s*(K|KG|KGS|KILO|KILOS|L|LT|LTS|M|MT|MTS|G|GR|GRS)\b/g, function (_m, num, u) {
            var norm = _normalizeToken(num + u);
            return _m + ' ' + norm + ' ' + num + 'K ' + num + 'KG ' + num + ' K ' + num + ' KG';
        });
        var rawWords = expanded.split(/[\s\-_/.,;:()[\]]+/).filter(Boolean);
        var words = [];
        var stems = [];
        for (var i = 0; i < rawWords.length; i++) {
            var w = rawWords[i];
            var nw = _normalizeToken(w);
            var sw = _stemToken(w);
            words.push(w);
            if (nw !== w) words.push(nw);
            stems.push(sw);
        }
        return {
            sku: sku,
            barcode: barcode,
            barcodeNoZeros: barcodeNoZeros,
            salesCode: salesCode,
            name: name,
            marca: marca,
            fullText: expanded,
            words: words,
            stems: stems
        };
    }

    function _productMatchesQuery(p, qRaw) {
        if (!qRaw || !String(qRaw).trim()) return { matched: true, tier: 5 };
        var qClean = _stripAccentsUpper(qRaw);
        var qNoZeros = qClean.replace(/^0+/, '');
        var tokens = _tokenizeQuery(qRaw);
        if (!tokens.length) return { matched: true, tier: 5 };

        var blob = _buildProductSearchBlob(p);

        // Coincidencia directa por código exacto (con o sin ceros a la izquierda)
        if (blob.sku === qClean ||
            (blob.barcode && (blob.barcode === qClean || (qNoZeros && blob.barcodeNoZeros === qNoZeros))) ||
            (blob.salesCode && blob.salesCode === qClean)) {
            return { matched: true, tier: 0 };
        }

        // Verificar que cada token de la búsqueda coincida en el producto
        for (var tIdx = 0; tIdx < tokens.length; tIdx++) {
            var tok = tokens[tIdx];
            var tokNorm = _normalizeToken(tok);
            var tokStem = _stemToken(tok);
            var tokNoZeros = tok.replace(/^0+/, '');
            var tokMatched = false;

            if (blob.fullText.indexOf(tok) !== -1 || blob.fullText.indexOf(tokNorm) !== -1) {
                tokMatched = true;
            } else if (tokStem && blob.fullText.indexOf(tokStem) !== -1) {
                tokMatched = true;
            } else if (tokNoZeros && tokNoZeros.length >= 3 && (blob.barcodeNoZeros.indexOf(tokNoZeros) !== -1 || blob.sku.indexOf(tokNoZeros) !== -1)) {
                tokMatched = true;
            } else {
                for (var wIdx = 0; wIdx < blob.words.length; wIdx++) {
                    var w = blob.words[wIdx];
                    var sw = blob.stems[wIdx] || w;
                    if (w.indexOf(tok) === 0 || w.indexOf(tokNorm) === 0 || (tokStem && sw.indexOf(tokStem) === 0)) {
                        tokMatched = true;
                        break;
                    }
                    if (tok.length >= 4 && (_editDistLe1(tok, w) || _editDistLe1(tokStem, sw))) {
                        tokMatched = true;
                        break;
                    }
                }
            }

            if (!tokMatched) {
                return { matched: false, tier: 99 };
            }
        }

        // Calcular prioridad de relevancia + orden alfanumérico natural
        var tier = 4;
        if (blob.sku.indexOf(qClean) === 0 || (blob.barcode && blob.barcode.indexOf(qClean) === 0) || (blob.salesCode && blob.salesCode.indexOf(qClean) === 0)) {
            tier = 1;
        } else if (blob.name.indexOf(qClean) === 0) {
            tier = 2;
        } else if (blob.marca === qClean || blob.marca.indexOf(qClean) === 0) {
            tier = 3;
        }
        return { matched: true, tier: tier };
    }

    function _alnumNaturalCompare(aStr, bStr) {
        var a = _stripAccentsUpper(aStr || '');
        var b = _stripAccentsUpper(bStr || '');
        if (a === b) return 0;
        var re = /(\d+|\D+)/g;
        var aParts = a.match(re) || [];
        var bParts = b.match(re) || [];
        var len = Math.min(aParts.length, bParts.length);
        for (var i = 0; i < len; i++) {
            var ap = aParts[i];
            var bp = bParts[i];
            if (ap === bp) continue;
            var aIsNum = /^\d+$/.test(ap);
            var bIsNum = /^\d+$/.test(bp);
            if (aIsNum && bIsNum) {
                var diff = parseInt(ap, 10) - parseInt(bp, 10);
                if (diff !== 0) return diff;
                return ap.length - bp.length;
            }
            if (aIsNum !== bIsNum) {
                return aIsNum ? -1 : 1;
            }
            return ap < bp ? -1 : 1;
        }
        return aParts.length - bParts.length;
    }

    // Estado del modal de filtro rápido (F4 / F5 / F6)
    var _qfMode = 'familia'; // 'familia' | 'depto' | 'marca'
    var _qfOptions = [];

    // Estado del modal de Kardex Global / Por Producto (F12)
    var _kdxData = {
        branches: [],
        products: [],
        movements: []
    };

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function fmtMoney(val) {
        var n = parseFloat(val);
        if (isNaN(n)) n = 0;
        return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtQty(val) {
        var n = parseFloat(val);
        if (isNaN(n)) n = 0;
        return n % 1 === 0 ? n.toFixed(2) : n.toFixed(2);
    }

    function meta(p, k, fb) {
        if (p && p[k] !== undefined && p[k] !== null && p[k] !== '') return p[k];
        if (p && p.meta_data && typeof p.meta_data === 'object' && p.meta_data[k] !== undefined && p.meta_data[k] !== null && p.meta_data[k] !== '') {
            return p.meta_data[k];
        }
        return fb !== undefined ? fb : '';
    }

    function getFamilia(p) {
        return String(meta(p, 'familia', meta(p, 'category', 'GENERAL')) || 'GENERAL').trim().toUpperCase();
    }

    function getDepto(p) {
        return String(meta(p, 'departamento', 'GENERAL') || 'GENERAL').trim().toUpperCase();
    }

    function getMarca(p) {
        return String(meta(p, 'marca', meta(p, 'brand', 'GENÉRICO')) || 'GENÉRICO').trim().toUpperCase();
    }

    function isPromo(p) {
        var m = (p && p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        if (p.en_oferta || p.promo || m.en_oferta || m.oferta_activa || (parseFloat(m.precio_oferta || 0) > 0) || (parseFloat(m.descuento_oferta || 0) > 0)) {
            return true;
        }
        var pScales = Array.isArray(m.price_scales) && m.price_scales.length ? m.price_scales : (Array.isArray(p.price_scales) ? p.price_scales : []);
        for (var i = 0; i < pScales.length; i++) {
            if (pScales[i] && parseFloat(pScales[i].oferta || 0) > 0) return true;
        }
        var bScales = Array.isArray(m.branch_price_scales) ? m.branch_price_scales : [];
        for (var j = 0; j < bScales.length; j++) {
            if (bScales[j] && parseFloat(bScales[j].oferta || 0) > 0) return true;
        }
        var pOffers = Array.isArray(m.product_offers) ? m.product_offers : [];
        var nowMs = Date.now();
        for (var k = 0; k < pOffers.length; k++) {
            var ofIt = pOffers[k];
            if (!ofIt || ofIt.paused) continue;
            if (ofIt.vigencia_type === 'FECHAS') {
                var endMs = ofIt.end_at ? Date.parse(ofIt.end_at) : NaN;
                if (!isNaN(endMs) && nowMs > endMs) continue;
            }
            if (ofIt.modality === 'LIMITE_STOCK' && parseFloat(ofIt.sold_stock || 0) >= parseFloat(ofIt.max_stock || 1)) continue;
            if (parseFloat(ofIt.discount_pct || 0) > 0 || parseFloat(ofIt.offer_price || 0) > 0) return true;
        }
        return false;
    }

    function isActive(p) {
        var m = (p && p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        if (p.activo === false || m.activo === false || m.status === 'INACTIVE') return false;
        return true;
    }

    function isPackageKit(p) {
        if (!p) return false;
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        if (p.is_package_kit || m.is_package_kit || m.es_paquete) return true;
        if (m.package_config && Array.isArray(m.package_config.components) && m.package_config.components.length > 0) return true;
        if (m.kardex && m.kardex.recetas && Array.isArray(m.package_components) && m.package_components.length > 0) return true;
        return false;
    }

    var PKT_STORAGE_KEY = 'calebsys_packages_catalog_v1';

    function _loadLocalPackagesCatalog() {
        try {
            var raw = localStorage.getItem(PKT_STORAGE_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function _saveLocalPackagesCatalog(list) {
        try {
            localStorage.setItem(PKT_STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        } catch (e) {}
    }

    function _syncLocalPackagesIntoMaster() {
        var localPkts = _loadLocalPackagesCatalog();
        if (!localPkts.length) return;
        mergeIntoMasterProducts(localPkts);
        _allProducts = _masterProducts;
        global._productsCache = _allProducts;
    }

    // ========================================================================
    // CARGA PRINCIPAL DESDE /api/products/search
    // ========================================================================
    function mergeIntoMasterProducts(newList) {
        if (!Array.isArray(newList)) return;
        var bySku = {};
        _masterProducts.forEach(function (p) {
            if (p && p.sku) bySku[String(p.sku)] = p;
        });
        newList.forEach(function (p) {
            if (p && p.sku) bySku[String(p.sku)] = p;
        });
        _masterProducts = Object.keys(bySku).map(function (k) { return bySku[k]; });
    }

    function keepSearchInputFocused(forceImmediate) {
        var applyFocus = function () {
            var root = document.getElementById('productos-root');
            if (!root || root.offsetParent === null) return;
            if (isAnyModalOpen()) return;
            var inp = document.getElementById('products-search-input');
            if (!inp) return;
            var active = document.activeElement;
            // Permitir abrir los <select> de filtro; al cambiar regresarán el foco al buscador
            if (active && active !== inp && active.tagName === 'SELECT' && root.contains(active)) {
                return;
            }
            if (active !== inp) {
                try {
                    inp.focus({ preventScroll: true });
                } catch (e) {
                    try { inp.focus(); } catch (e2) {}
                }
            }
        };
        if (forceImmediate) {
            applyFocus();
        }
        setTimeout(applyFocus, 15);
    }

    function scheduleSearchAutoClear4s() {
        clearTimeout(_inactivityClearTimer);
        var inp = document.getElementById('products-search-input');
        if (!inp || !inp.value) return;
        _inactivityClearTimer = setTimeout(function () {
            var currentInp = document.getElementById('products-search-input');
            var clearBtn = document.getElementById('products-search-clear');
            if (currentInp && currentInp.value) {
                // Dejar la barra en blanco lista para la siguiente búsqueda SIN mover el artículo ni la tabla actual
                currentInp.value = '';
            }
            if (clearBtn) {
                clearBtn.style.display = 'none';
            }
            keepSearchInputFocused(true);
        }, 1500);
    }

    function bindSearchInputDirect() {
        var root = document.getElementById('productos-root');
        var inp = document.getElementById('products-search-input');
        var clearBtn = document.getElementById('products-search-clear');
        var searchBtn = document.getElementById('products-search-btn');

        if (inp) {
            inp.setAttribute('placeholder', 'Busqueda');
        }

        if (root && !root.__calebFocusGuardBound) {
            root.__calebFocusGuardBound = true;
            root.addEventListener('mouseup', function (ev) {
                var t = ev.target;
                if (t && (t.tagName === 'SELECT' || (t.closest && t.closest('select')))) return;
                keepSearchInputFocused(false);
            });
            root.querySelectorAll('select').forEach(function (sel) {
                sel.addEventListener('change', function () {
                    keepSearchInputFocused(false);
                });
            });
        }

        if (inp && !inp.__calebSearchBound) {
            inp.__calebSearchBound = true;
            inp.addEventListener('blur', function () {
                keepSearchInputFocused(false);
            });
            inp.addEventListener('input', function () {
                if (isAnyModalOpen()) return;
                var qVal = String(inp.value || '').trim();
                _retainedSearchQuery = qVal;
                if (clearBtn) clearBtn.style.display = inp.value ? 'inline-flex' : 'none';
                // Filtrado instantáneo en cliente (0ms) en orden alfanumérico al teclear
                applyClientFilters(null, _retainedSearchQuery);
                // Programar limpieza automática de la barra tras 4 segundos de inactividad sin mover el artículo buscado
                scheduleSearchAutoClear4s();
                // Respaldo asíncrono con el backend sin bloquear la tabla ni quitar el foco
                clearTimeout(_searchTimer);
                _searchTimer = setTimeout(function () {
                    syncSearchFromBackend(qVal, false);
                }, 220);
            });
            inp.addEventListener('keydown', function (ev) {
                if (isAnyModalOpen()) return;
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    if (!_filtered.length) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    var curIdx = _filtered.findIndex(function (p) { return p.sku === _selectedSku; });
                    var nextIdx = ev.key === 'ArrowDown'
                        ? Math.min(_filtered.length - 1, curIdx + 1)
                        : Math.max(0, curIdx - 1);
                    if (nextIdx >= 0 && _filtered[nextIdx]) {
                        selectRow(_filtered[nextIdx].sku, true);
                    }
                    scheduleSearchAutoClear4s();
                } else if (ev.key === 'Enter') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (String(inp.value || '').trim() !== '') {
                        global.productsSearchNow();
                    } else {
                        global.productsEditar();
                    }
                } else if (ev.key === 'Insert') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    global.productsNuevoProducto();
                } else if (ev.key === 'Delete' && !inp.value) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    global.productsEliminar();
                } else if ((ev.key === ' ' || ev.code === 'Space') && !inp.value) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    toggleCheckSku(_selectedSku);
                } else if (ev.key === 'Escape') {
                    if (inp.value) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        inp.value = '';
                        if (clearBtn) clearBtn.style.display = 'none';
                        keepSearchInputFocused(true);
                    }
                }
            });
        }
        if (clearBtn && inp) {
            clearBtn.style.display = inp.value ? 'inline-flex' : 'none';
            if (!clearBtn.__calebClearBound) {
                clearBtn.__calebClearBound = true;
                clearBtn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    global.productsSearchClear();
                });
            }
        }
        if (searchBtn && !searchBtn.__calebBtnBound) {
            searchBtn.__calebBtnBound = true;
            searchBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                global.productsSearchNow();
            });
        }
        keepSearchInputFocused(true);
    }

    async function syncSearchFromBackend(query, showFeedbackToast) {
        try {
            var q = String(query !== undefined ? query : _retainedSearchQuery || '').trim();
            var url = '/api/products/search?limit=500' + (q ? '&q=' + encodeURIComponent(q) : '');
            var response = await fetch(url, { credentials: 'include' });
            if (!response.ok) return;
            var products = await response.json();
            if (Array.isArray(products)) {
                if (!q) {
                    _masterProducts = products;
                } else {
                    mergeIntoMasterProducts(products);
                }
                _allProducts = _masterProducts.length ? _masterProducts : products;
                global._productsCache = _allProducts;
                // Si el usuario buscó algo y ya pasaron los 4s o sigue en esa búsqueda, mantener _retainedSearchQuery
                if (q === _retainedSearchQuery) {
                    applyClientFilters(products, _retainedSearchQuery);
                }
                if (showFeedbackToast && typeof global.showToast === 'function') {
                    if (_filtered.length === 0 && q) {
                        global.showToast('Sin coincidencias para "' + q + '".', 'warning');
                    }
                }
            }
        } catch (err) {
            console.warn('[CALEBSYS] Error sincronizando búsqueda:', err);
        }
        keepSearchInputFocused(false);
    }

    async function loadProducts(query) {
        if (query === undefined) query = '';
        var tbodyContainer = document.getElementById('products-table-body');
        var countLabel = document.getElementById('products-count');
        if (!tbodyContainer) return;

        bindSearchInputDirect();
        bindKeyboard();

        // Si ya tenemos el catálogo cargado y el usuario está buscando algo, filtrar al instante sin destruir la tabla
        if (_masterProducts.length > 0 && query) {
            _retainedSearchQuery = String(query).trim();
            applyClientFilters(null, _retainedSearchQuery);
            scheduleSearchAutoClear4s();
            await syncSearchFromBackend(query, false);
            keepSearchInputFocused(true);
            return;
        }

        tbodyContainer.innerHTML =
            '<div class="loading-state">' +
                '<div class="spinner"></div>' +
                '<div class="loading-text">Cargando catálogo de productos en tiempo real...</div>' +
            '</div>';

        try {
            var url = '/api/products/search?limit=500' + (query ? '&q=' + encodeURIComponent(query) : '');
            var response = await fetch(url, { credentials: 'include' });
            if (!response.ok) throw new Error('HTTP ' + response.status);

            var products = await response.json();
            var arr = Array.isArray(products) ? products : [];
            if (!query) {
                _masterProducts = arr;
            } else {
                mergeIntoMasterProducts(arr);
            }
            _syncLocalPackagesIntoMaster();
            _allProducts = _masterProducts.length ? _masterProducts : arr;
            global._productsCache = _allProducts;

            populateFilterSelects(_allProducts);
            updateStatsAndInfo(_allProducts);
            applyClientFilters(query ? arr : null, query);
            keepSearchInputFocused(true);
        } catch (err) {
            console.error('[CALEBSYS] Error cargando productos:', err);
            tbodyContainer.innerHTML =
                '<div class="error-state" style="margin:16px;">' +
                    '<i class="fa-solid fa-triangle-exclamation"></i>' +
                    '<div class="error-state-text">' +
                        '<strong>No se pudo conectar con /api/products/search</strong>' +
                        '<span>Verifica que el servidor esté activo (' + escapeHtml(err.message) + ')</span>' +
                    '</div>' +
                '</div>';
            if (countLabel) countLabel.textContent = 'Error de conexión';
            keepSearchInputFocused(true);
        }
    }

    function formatPublicScaleLabel(scaleName) {
        var s = String(scaleName || 'PRECIO DE LISTA').trim().toUpperCase();
        return (s === 'PRECIO DE LISTA' || s === 'PRECIO PUBLICO' || s === 'PRECIO PÚBLICO') ? 'PRECIO PÚBLICO' : s;
    }

    function getActiveSucursalEscalaFilter() {
        var sucSel = document.getElementById('pc-f-sucursal');
        var escSel = document.getElementById('pc-f-escala');
        var legacySel = document.getElementById('pc-f-sucursal-escala');

        var branchName = 'MATRIZ';
        var scaleName = 'PRECIO DE LISTA';

        if (sucSel || escSel) {
            branchName = String((sucSel && sucSel.value) || 'MATRIZ').trim().toUpperCase() || 'MATRIZ';
            scaleName = String((escSel && escSel.value) || 'PRECIO DE LISTA').trim().toUpperCase() || 'PRECIO DE LISTA';
        } else if (legacySel && legacySel.value) {
            var parts = String(legacySel.value).split('||');
            branchName = String(parts[0] || 'MATRIZ').trim().toUpperCase() || 'MATRIZ';
            scaleName = String(parts[1] || 'PRECIO DE LISTA').trim().toUpperCase() || 'PRECIO DE LISTA';
        }

        if (scaleName === 'PRECIO PUBLICO' || scaleName === 'PRECIO PÚBLICO') {
            scaleName = 'PRECIO DE LISTA';
        }
        var prettyScale = formatPublicScaleLabel(scaleName);
        return {
            key: branchName + '||' + scaleName,
            branch_name: branchName,
            scale_name: scaleName,
            pretty_scale: prettyScale,
            label: branchName + ' - ' + prettyScale
        };
    }

    function getProductEffectivePriceForSelection(p, activeSel) {
        activeSel = activeSel || getActiveSucursalEscalaFilter();
        var basePrice = parseFloat(p.price) || 0;
        var pScales = Array.isArray(p.price_scales) && p.price_scales.length
            ? p.price_scales
            : (p.meta_data && Array.isArray(p.meta_data.price_scales) ? p.meta_data.price_scales : []);
        var bScales = (p.meta_data && Array.isArray(p.meta_data.branch_price_scales)) ? p.meta_data.branch_price_scales : [];

        // 1. Buscar primero en branch_price_scales si la sucursal + escala existe
        var matchedBranchScale = bScales.find(function (bs) {
            if (!bs || bs.activa === false || bs.active === false) return false;
            var bNm = String(bs.branch_name || bs.branch_id || 'MATRIZ').trim().toUpperCase();
            var bId = String(bs.branch_id || bs.branch_name || 'MATRIZ').trim().toUpperCase();
            var sNm = String(bs.scale_name || 'PRECIO DE LISTA').trim().toUpperCase();
            if (sNm === 'PRECIO PUBLICO' || sNm === 'PRECIO PÚBLICO') sNm = 'PRECIO DE LISTA';
            return (bNm === activeSel.branch_name || bId === activeSel.branch_name) && sNm === activeSel.scale_name;
        });

        // 2. Si es MATRIZ / Tienda #1, priorizar price_scales (donde MATRIZ - PRECIO DE LISTA es la escala 1 por defecto)
        var isMainMatriz = activeSel.branch_name === 'MATRIZ' || activeSel.branch_name === 'MADERAS Y MATERIALES MAGDALENO';
        if (isMainMatriz) {
            var matchedScale = pScales.find(function (s) {
                if (!s || s.activa === false || s.active === false) return false;
                var sNm = String(s.scale_name || s.nombre || s.name || '').trim().toUpperCase();
                if (sNm === 'PRECIO PUBLICO' || sNm === 'PRECIO PÚBLICO') sNm = 'PRECIO DE LISTA';
                return sNm === activeSel.scale_name;
            });
            if (matchedScale) {
                var sp = parseFloat(matchedScale.precio != null ? matchedScale.precio : (matchedScale.price != null ? matchedScale.price : matchedScale.precio_activo)) || 0;
                if (sp > 0) return sp;
            }
            if (activeSel.scale_name === 'PRECIO DE LISTA' && basePrice > 0) {
                return basePrice;
            }
        }

        if (matchedBranchScale) {
            var bp = parseFloat(matchedBranchScale.precio != null ? matchedBranchScale.precio : matchedBranchScale.price) || 0;
            if (bp > 0) return bp;
        }

        // Fallback a la escala general solicitada
        var fallbackScale = pScales.find(function (s) {
            if (!s || s.activa === false || s.active === false) return false;
            var sNm = String(s.scale_name || s.nombre || s.name || '').trim().toUpperCase();
            if (sNm === 'PRECIO PUBLICO' || sNm === 'PRECIO PÚBLICO') sNm = 'PRECIO DE LISTA';
            return sNm === activeSel.scale_name;
        });
        if (fallbackScale) {
            var fp = parseFloat(fallbackScale.precio != null ? fallbackScale.precio : (fallbackScale.price != null ? fallbackScale.price : fallbackScale.precio_activo)) || 0;
            if (fp > 0) return fp;
        }

        return basePrice;
    }

    function getProductEffectiveMarginForSelection(p, activeSel, costo, price) {
        activeSel = activeSel || getActiveSucursalEscalaFilter();
        var pScales = Array.isArray(p.price_scales) && p.price_scales.length
            ? p.price_scales
            : (p.meta_data && Array.isArray(p.meta_data.price_scales) ? p.meta_data.price_scales : []);
        var bScales = (p.meta_data && Array.isArray(p.meta_data.branch_price_scales)) ? p.meta_data.branch_price_scales : [];

        var matchedBranchScale = bScales.find(function (bs) {
            if (!bs || bs.activa === false || bs.active === false) return false;
            var bNm = String(bs.branch_name || bs.branch_id || 'MATRIZ').trim().toUpperCase();
            var bId = String(bs.branch_id || bs.branch_name || 'MATRIZ').trim().toUpperCase();
            var sNm = String(bs.scale_name || 'PRECIO DE LISTA').trim().toUpperCase();
            if (sNm === 'PRECIO PUBLICO' || sNm === 'PRECIO PÚBLICO') sNm = 'PRECIO DE LISTA';
            return (bNm === activeSel.branch_name || bId === activeSel.branch_name) && sNm === activeSel.scale_name;
        });

        var isMainMatrizM = activeSel.branch_name === 'MATRIZ' || activeSel.branch_name === 'MADERAS Y MATERIALES MAGDALENO';
        if (isMainMatrizM) {
            var matchedScale = pScales.find(function (s) {
                if (!s || s.activa === false || s.active === false) return false;
                var sNm = String(s.scale_name || s.nombre || s.name || '').trim().toUpperCase();
                if (sNm === 'PRECIO PUBLICO' || sNm === 'PRECIO PÚBLICO') sNm = 'PRECIO DE LISTA';
                return sNm === activeSel.scale_name;
            });
            if (matchedScale) {
                var sm = parseFloat(matchedScale.margen_trabajo != null ? matchedScale.margen_trabajo : (matchedScale.margin != null ? matchedScale.margin : matchedScale.margen_ideal));
                if (!isNaN(sm) && sm > 0) return sm;
            }
            if (activeSel.scale_name === 'PRECIO DE LISTA') {
                var savedM = parseFloat(meta(p, 'margen_final_pieza', meta(p, 'margen', NaN)));
                if (!isNaN(savedM) && savedM > 0) return savedM;
            }
        }

        if (matchedBranchScale) {
            var bm = parseFloat(matchedBranchScale.margen_final != null ? matchedBranchScale.margen_final : matchedBranchScale.margen_ideal);
            if (!isNaN(bm) && bm > 0) return bm;
        }

        if (costo > 0 && price > 0) {
            var ivaPct = parseFloat(meta(p, 'iva', 16));
            if (isNaN(ivaPct)) ivaPct = 16;
            var netPrice = price / (1 + (ivaPct / 100));
            var calcM = ((netPrice / costo) - 1) * 100;
            if (isFinite(calcM) && calcM >= 0) return calcM;
        }
        return 0;
    }

    function fmtMarginPct(val) {
        var n = parseFloat(val);
        if (isNaN(n)) n = 0;
        var rounded = Math.round(n * 100) / 100;
        return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)) + '%';
    }

    function getProductEffectiveStockForBranch(p, branchName) {
        var bTarget = String(branchName || 'MATRIZ').trim().toUpperCase() || 'MATRIZ';
        var totalStock = parseFloat(p.stock) || 0;
        var bStocks = (p.meta_data && p.meta_data.branch_stocks && typeof p.meta_data.branch_stocks === 'object')
            ? p.meta_data.branch_stocks
            : null;
        if (bStocks) {
            if (bStocks[bTarget] !== undefined) {
                return parseFloat(bStocks[bTarget]) || 0;
            }
            var foundKey = Object.keys(bStocks).find(function (k) {
                return String(k).trim().toUpperCase() === bTarget;
            });
            if (foundKey !== undefined) {
                return parseFloat(bStocks[foundKey]) || 0;
            }
        }
        return bTarget === 'MATRIZ' ? totalStock : 0;
    }

    function populateFilterSelects(list) {
        var sucSel = document.getElementById('pc-f-sucursal');
        var escSel = document.getElementById('pc-f-escala');
        var famSel = document.getElementById('pc-f-familia');
        var depSel = document.getElementById('pc-f-depto');
        var marSel = document.getElementById('pc-f-marca');

        var branches = [];
        var seenBranches = {};
        var addBranch = function (branchKey, branchLabel) {
            var bKey = String(branchKey || 'MATRIZ').trim().toUpperCase() || 'MATRIZ';
            var bLbl = String(branchLabel || bKey).trim().toUpperCase() || bKey;
            if (seenBranches[bKey]) return;
            seenBranches[bKey] = true;
            branches.push({ value: bKey, label: bLbl });
        };

        var scales = [];
        var seenScales = {};
        var addScale = function (scaleName) {
            var sNm = String(scaleName || 'PRECIO DE LISTA').trim().toUpperCase() || 'PRECIO DE LISTA';
            if (sNm === 'PRECIO PUBLICO' || sNm === 'PRECIO PÚBLICO') sNm = 'PRECIO DE LISTA';
            if (seenScales[sNm]) return;
            seenScales[sNm] = true;
            scales.push({ value: sNm, label: formatPublicScaleLabel(sNm) });
        };

        addBranch('MATRIZ', 'MATRIZ');
        addScale('PRECIO DE LISTA');

        list.forEach(function (p) {
            var m = (p && p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
            if (Array.isArray(m.branches_list)) {
                m.branches_list.forEach(function (b) {
                    if (b) addBranch(b.name || b.id || 'MATRIZ', b.name || b.id || 'MATRIZ');
                });
            }
            var pScales = Array.isArray(p.price_scales) && p.price_scales.length
                ? p.price_scales
                : (Array.isArray(m.price_scales) ? m.price_scales : []);
            pScales.forEach(function (s) {
                if (s && s.activa !== false && s.active !== false) {
                    addScale(s.scale_name || s.nombre || s.name || 'PRECIO DE LISTA');
                }
            });
            var bScales = Array.isArray(m.branch_price_scales) ? m.branch_price_scales : [];
            bScales.forEach(function (bs) {
                if (bs && bs.activa !== false && bs.active !== false) {
                    addBranch(bs.branch_name || bs.branch_id || 'MATRIZ', bs.branch_name || bs.branch_id || 'MATRIZ');
                    addScale(bs.scale_name || 'PRECIO DE LISTA');
                }
            });
            if (m.branch_stocks && typeof m.branch_stocks === 'object') {
                Object.keys(m.branch_stocks).forEach(function (k) {
                    addBranch(k, k);
                });
            }
        });

        if (sucSel) {
            var curSuc = String(sucSel.value || 'MATRIZ').trim().toUpperCase();
            sucSel.innerHTML = branches.map(function (b) {
                return '<option value="' + escapeHtml(b.value) + '">' + escapeHtml(b.label) + '</option>';
            }).join('');
            sucSel.value = seenBranches[curSuc] ? curSuc : 'MATRIZ';
        }

        if (escSel) {
            var curEsc = String(escSel.value || 'PRECIO DE LISTA').trim().toUpperCase();
            if (curEsc === 'PRECIO PUBLICO' || curEsc === 'PRECIO PÚBLICO') curEsc = 'PRECIO DE LISTA';
            escSel.innerHTML = scales.map(function (s) {
                return '<option value="' + escapeHtml(s.value) + '">' + escapeHtml(s.label) + '</option>';
            }).join('');
            escSel.value = seenScales[curEsc] ? curEsc : 'PRECIO DE LISTA';
        }

        var fams = Array.from(new Set(list.map(getFamilia).filter(Boolean))).sort();
        var deps = Array.from(new Set(list.map(getDepto).filter(Boolean))).sort();
        var mars = Array.from(new Set(list.map(getMarca).filter(Boolean))).sort();

        if (famSel) {
            var curFam = famSel.value;
            famSel.innerHTML = '<option value="">Todas las Familias</option>' +
                fams.map(function (v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
            if (fams.indexOf(curFam) !== -1) famSel.value = curFam;
        }
        if (depSel) {
            var curDep = depSel.value;
            depSel.innerHTML = '<option value="">Todos los Deptos.</option>' +
                deps.map(function (v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
            if (deps.indexOf(curDep) !== -1) depSel.value = curDep;
        }
        if (marSel) {
            var curMar = marSel.value;
            marSel.innerHTML = '<option value="">Todas las Marcas</option>' +
                mars.map(function (v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
            if (mars.indexOf(curMar) !== -1) marSel.value = curMar;
        }
    }

    var UNIT_TO_SAT_DEFAULT = {
        'PIEZA': 'H87', 'PZA': 'H87', 'PZAS': 'H87', 'UNIDAD': 'H87',
        'METRO': 'MTR', 'MTR': 'MTR', 'KILOGRAMO': 'KGM', 'KG': 'KGM', 'KGM': 'KGM',
        'LITRO': 'LTR', 'LT': 'LTR', 'LTR': 'LTR', 'TONELADA': 'TNE', 'TON': 'TNE',
        'M3': 'MTQ', 'MTQ': 'MTQ', 'M2': 'MTK', 'MTK': 'MTK',
        'CAJA': 'XBX', 'PAQUETE': 'XPK', 'BOLSA': 'XBG', 'SACO': 'XSA', 'BULTO': 'XSA',
        'ROLLO': 'XRO', 'CUBETA': 'XBJ', 'GALON': 'GLL', 'JUEGO': 'SET', 'SERVICIO': 'E48'
    };

    function updateSelectedProductBottomBanner() {
        var p = getSelectedProduct();
        var descEl = document.getElementById('pc-bot-desc');
        var taxEl = document.getElementById('pc-bot-taxonomy');
        var cfdiEl = document.getElementById('pc-bot-cfdi');
        var imgEl = document.getElementById('pc-bot-img');
        var phEl = document.getElementById('pc-bot-img-placeholder');

        if (!p) {
            if (descEl) descEl.textContent = 'SIN PRODUCTO SELECCIONADO';
            if (taxEl) taxEl.innerHTML = 'FAMILIA: — <span class="sep">***</span> DEPARTAMENTO: — <span class="sep">***</span> MARCA: —';
            if (cfdiEl) cfdiEl.innerHTML = 'CODIGO CFDI : — &nbsp;&nbsp; UNIDAD CFDI : —';
            if (imgEl) { imgEl.style.display = 'none'; imgEl.src = ''; }
            if (phEl) phEl.style.display = 'flex';
            return;
        }

        var fullDesc = String(p.name || p.description || p.sku || '—').trim().toUpperCase();
        var fam = getFamilia(p);
        var dep = getDepto(p);
        var mar = getMarca(p);
        var unitRaw = String(p.sale_unit || 'PIEZA').trim().toUpperCase();
        var satId = String(meta(p, 'sat_id', meta(p, 'clave_sat', meta(p, 'cfdi_code', '01010101'))) || '01010101').trim().toUpperCase();
        var satUn = String(meta(p, 'sat_unidad', meta(p, 'clave_unidad_sat', UNIT_TO_SAT_DEFAULT[unitRaw] || 'H87')) || 'H87').trim().toUpperCase();
        var imgUrl = String(p.foto_url || p.image_url || meta(p, 'foto_url', meta(p, 'image_url', meta(p, 'imagen', ''))) || '').trim();

        if (descEl) {
            descEl.textContent = fullDesc;
            descEl.title = fullDesc;
        }
        if (taxEl) {
            taxEl.innerHTML =
                'FAMILIA: ' + escapeHtml(fam) +
                ' <span class="sep">***</span> ' +
                'DEPARTAMENTO: ' + escapeHtml(dep) +
                ' <span class="sep">***</span> ' +
                'MARCA: ' + escapeHtml(mar);
        }
        if (cfdiEl) {
            cfdiEl.innerHTML =
                'CODIGO CFDI : ' + escapeHtml(satId) +
                ' &nbsp;&nbsp;&nbsp; UNIDAD CFDI : ' + escapeHtml(satUn);
        }

        var hasValidImg = imgUrl &&
            imgUrl !== 'null' &&
            imgUrl !== 'undefined' &&
            (imgUrl.indexOf('data:image/') === 0 ||
             ((imgUrl.indexOf('http') === 0 || imgUrl.indexOf('/') === 0 || imgUrl.indexOf('uploads/') !== -1) &&
              !(/\/admin(\b|#|\?|$)/i.test(imgUrl) && !/\.(png|jpe?g|webp|gif|svg|avif|bmp)(\?|$)/i.test(imgUrl))));

        if (imgEl && phEl) {
            if (hasValidImg) {
                imgEl.src = imgUrl;
                imgEl.style.display = 'block';
                phEl.style.display = 'none';
                imgEl.onerror = function () {
                    imgEl.style.display = 'none';
                    phEl.style.display = 'flex';
                };
            } else {
                imgEl.removeAttribute('src');
                imgEl.style.display = 'none';
                phEl.style.display = 'flex';
            }
        }
    }

    function updateStatsAndInfo(list) {
        updateCheckedCounter();
        updateSelectedProductBottomBanner();
    }

    function updateCheckedCounter() {
        var el = document.getElementById('pc-info-total');
        if (el) {
            var count = _checked.size;
            el.textContent = count > 0 ? (count + (count === 1 ? ' producto marcado' : ' productos marcados')) : (_allProducts.length + ' en catálogo');
            el.style.color = count > 0 ? '#10b981' : 'var(--text-primary)';
        }
        var btnMarcar = document.getElementById('pc-btn-marcar');
        if (btnMarcar) {
            btnMarcar.classList.toggle('active', _selectedSku && _checked.has(_selectedSku));
        }
    }

    function applyClientFilters(backendMatchedSubset, queryOverride) {
        var activeSel = getActiveSucursalEscalaFilter();
        var fam = (document.getElementById('pc-f-familia') || {}).value || '';
        var dep = (document.getElementById('pc-f-depto') || {}).value || '';
        var mar = (document.getElementById('pc-f-marca') || {}).value || '';
        var est = (document.getElementById('pc-f-estado') || {}).value || '';
        var searchInp = document.getElementById('products-search-input');
        var qRaw = queryOverride !== undefined
            ? String(queryOverride || '').trim()
            : (String((searchInp && searchInp.value) || '').trim() || _retainedSearchQuery);
        var clearBtn = document.getElementById('products-search-clear');
        if (clearBtn) clearBtn.style.display = (searchInp && searchInp.value) ? 'inline-flex' : 'none';

        // Actualizar estado visual de los botones de filtro en la barra superior
        var btnFam = document.getElementById('pc-btn-familia');
        var btnDep = document.getElementById('pc-btn-depto');
        var btnMar = document.getElementById('pc-btn-marca');
        var btnOfe = document.getElementById('pc-btn-ofertas');
        var btnPkt = document.getElementById('pc-btn-paquetes');
        if (btnFam) btnFam.classList.toggle('active', Boolean(fam));
        if (btnDep) btnDep.classList.toggle('active', Boolean(dep));
        if (btnMar) btnMar.classList.toggle('active', Boolean(mar));
        if (btnOfe) btnOfe.classList.toggle('active', Boolean(_onlyPromo || est === 'ofertas'));
        if (btnPkt) btnPkt.classList.toggle('active', Boolean(est === 'paquetes'));

        var backendSkuSet = null;
        if (Array.isArray(backendMatchedSubset) && qRaw) {
            backendSkuSet = {};
            backendMatchedSubset.forEach(function (bp) {
                if (bp && bp.sku) backendSkuSet[String(bp.sku)] = true;
            });
        }

        var sourceList = _masterProducts.length ? _masterProducts : _allProducts;
        var scored = [];

        sourceList.forEach(function (p) {
            if (fam && getFamilia(p) !== fam) return;
            if (dep && getDepto(p) !== dep) return;
            if (mar && getMarca(p) !== mar) return;
            var s = getProductEffectiveStockForBranch(p, activeSel.branch_name);
            if (est === 'activos' && (!isActive(p) || s <= 0)) return;
            if (est === 'inactivos' && (isActive(p) && s > 0)) return;
            if ((est === 'ofertas' || _onlyPromo) && !isPromo(p)) return;
            if (est === 'paquetes' && !isPackageKit(p)) return;

            if (qRaw) {
                var matchInfo = _productMatchesQuery(p, qRaw);
                var matchedByBackend = Boolean(backendSkuSet && p.sku && backendSkuSet[String(p.sku)]);
                if (!matchInfo.matched && !matchedByBackend) return;
                scored.push({
                    p: p,
                    tier: matchInfo.matched ? matchInfo.tier : 4
                });
            } else {
                scored.push({
                    p: p,
                    tier: 5
                });
            }
        });

        // Ordenar en ORDEN ALFANUMÉRICO NATURAL (0-9, A-Z)
        scored.sort(function (a, b) {
            if (qRaw && a.tier !== b.tier) {
                return a.tier - b.tier;
            }
            var cmpName = _alnumNaturalCompare(a.p.name || a.p.description || a.p.sku, b.p.name || b.p.description || b.p.sku);
            if (cmpName !== 0) return cmpName;
            return _alnumNaturalCompare(a.p.sku, b.p.sku);
        });

        _filtered = scored.map(function (item) { return item.p; });

        renderTable(_filtered, qRaw);
        updateStatsAndInfo(sourceList);
    }

    function renderTable(list, activeQuery) {
        var tbodyContainer = document.getElementById('products-table-body');
        var countLabel = document.getElementById('products-count');
        if (!tbodyContainer) return;

        var activeSel = getActiveSucursalEscalaFilter();
        var activeFilters = [activeSel.label];
        var fam = (document.getElementById('pc-f-familia') || {}).value || '';
        var dep = (document.getElementById('pc-f-depto') || {}).value || '';
        var mar = (document.getElementById('pc-f-marca') || {}).value || '';
        var qStr = activeQuery !== undefined ? String(activeQuery || '').trim() : String((document.getElementById('products-search-input') || {}).value || '').trim();
        if (qStr) activeFilters.push('Búsqueda: "' + qStr + '"');
        if (fam) activeFilters.push('Familia: ' + fam);
        if (dep) activeFilters.push('Depto: ' + dep);
        if (mar) activeFilters.push('Marca: ' + mar);
        if (_onlyPromo) activeFilters.push('Solo Ofertas');
        if (((document.getElementById('pc-f-estado') || {}).value || '') === 'paquetes') activeFilters.push('Paquetes / Kits [F10]');

        var totalCatalog = (_masterProducts.length || _allProducts.length);
        if (countLabel) {
            var filterSuffix = activeFilters.length ? ' · [' + activeFilters.join(' | ') + ']' : '';
            countLabel.textContent = 'Mostrando ' + list.length + ' de ' + totalCatalog + ' productos' + filterSuffix;
        }

        if (list.length === 0) {
            tbodyContainer.innerHTML =
                '<div class="empty-state">' +
                    '<i class="fa-solid fa-box-open"></i>' +
                    '<div class="empty-state-title">No se encontraron productos' + (qStr ? ' para "' + escapeHtml(qStr) + '"' : '') + '</div>' +
                    '<div class="empty-state-desc">Presiona <b>F9 (Sin Filtro)</b> para limpiar los filtros o <b>INS</b> para registrar un nuevo producto.</div>' +
                '</div>';
            updateSelectedProductBottomBanner();
            return;
        }

        if (!_selectedSku || !list.some(function (p) { return p.sku === _selectedSku; })) {
            _selectedSku = list[0].sku;
        }

        var allChk = list.length > 0 && list.every(function (p) { return _checked.has(p.sku); });
        var priceHeaderLabel = escapeHtml(activeSel.pretty_scale);
        var html =
            '<table class="pc-table"><thead><tr>' +
                '<th class="pc-chk"><input type="checkbox" data-change="productsToggleAll"' + (allChk ? ' checked' : '') + ' title="Marcar / Desmarcar todos"></th>' +
                '<th style="text-align:center;width:110px;">STOCK [F8]</th>' +
                '<th style="width:185px;">SKU / CÓDIGO</th>' +
                '<th>DESCRIPCIÓN DEL PRODUCTO</th>' +
                '<th style="width:120px;">UNIDAD</th>' +
                '<th class="pc-num" style="width:130px;">COSTO</th>' +
                '<th class="pc-num" style="width:110px;">MARGEN</th>' +
                '<th class="pc-num" style="width:155px;">' + priceHeaderLabel + '</th>' +
            '</tr></thead><tbody>';

        list.forEach(function (p) {
            var stock = getProductEffectiveStockForBranch(p, activeSel.branch_name);
            var price = getProductEffectivePriceForSelection(p, activeSel);
            var costo = parseFloat(p.average_cost != null ? p.average_cost : meta(p, 'costo', price * 0.72)) || 0;
            var marginPct = getProductEffectiveMarginForSelection(p, activeSel, costo, price);
            var unit = p.sale_unit || 'PIEZA';
            var promo = isPromo(p);
            var marcaStr = getMarca(p);
            var barcodeStr = String(p.barcode || meta(p, 'codigo_barras', '') || '').trim();
            var altCodeStr = String(p.sales_code || meta(p, 'codigo_alterno', '') || '').trim();

            var bCls = stock <= 0 ? 'low' : (stock <= (parseFloat(p.stock_minimo) || 5) ? 'mid' : 'ok');
            var sel = p.sku === _selectedSku ? ' sel' : '';
            var isChk = _checked.has(p.sku);
            var chkRowCls = isChk ? ' chk-row' : '';
            var skuEsc = escapeHtml(p.sku);
            var subCodeHtml = '';
            if (barcodeStr && barcodeStr.toUpperCase() !== String(p.sku || '').toUpperCase()) {
                subCodeHtml = '<div style="font-size:10px;color:#64748b;font-weight:600;line-height:1.15;margin-top:2px;"><i class="fa-solid fa-barcode" style="font-size:9px;margin-right:3px;"></i>' + escapeHtml(barcodeStr) + '</div>';
            } else if (altCodeStr && altCodeStr.toUpperCase() !== String(p.sku || '').toUpperCase()) {
                subCodeHtml = '<div style="font-size:10px;color:#64748b;font-weight:600;line-height:1.15;margin-top:2px;">ALT: ' + escapeHtml(altCodeStr) + '</div>';
            }
            var brandBadgeHtml = (marcaStr && marcaStr !== 'GENÉRICO' && marcaStr !== 'GENERICO')
                ? ' <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,.12);color:#38bdf8;border:1px solid rgba(56,189,248,.25);font-weight:700;margin-left:6px;">' + escapeHtml(marcaStr) + '</span>'
                : '';
            var pktBadgeHtml = '';
            if (isPackageKit(p)) {
                var pktCfg = (p.meta_data && p.meta_data.package_config) ? p.meta_data.package_config : {};
                var compCount = Array.isArray(pktCfg.components) ? pktCfg.components.length : 0;
                pktBadgeHtml = ' <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(14,165,233,.2);color:#38bdf8;border:1px solid rgba(56,189,248,.4);font-weight:800;margin-left:6px;">📦 PAQUETE / KIT' + (compCount ? ' (' + compCount + ' prod.)' : '') + '</span>';
            }

            html +=
                '<tr class="pc-row' + sel + chkRowCls + '" data-sku="' + skuEsc + '" data-click="productsSelectRow" data-click-arg="' + skuEsc + '" data-dblclick="productsEditRow" data-dblclick-arg="' + skuEsc + '">' +
                    '<td class="pc-chk"><input type="checkbox" data-change="productsToggleCheck" data-change-arg="' + skuEsc + '"' + (isChk ? ' checked' : '') + '></td>' +
                    '<td style="text-align:center;">' +
                        '<span class="pc-badge ' + bCls + '" data-click="productsOpenStockSku" data-click-arg="' + skuEsc + '" title="Clic o F8 para ver stock desglosado por sucursal">' +
                            fmtQty(stock) +
                        '</span>' +
                    '</td>' +
                    '<td class="pc-mono">' + skuEsc + subCodeHtml + '</td>' +
                    '<td class="pc-name">' +
                        escapeHtml(p.name || p.description || p.sku) +
                        brandBadgeHtml +
                        pktBadgeHtml +
                        (promo ? ' <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(245,158,11,.2);color:#fbbf24;font-weight:800;margin-left:6px;"><i class="fa-solid fa-bolt"></i> OFERTA</span>' : '') +
                    '</td>' +
                    '<td>' + escapeHtml(unit) + '</td>' +
                    '<td class="pc-num">' + fmtMoney(costo) + '</td>' +
                    '<td class="pc-num" style="font-weight:700;color:var(--pc-ok);">' + fmtMarginPct(marginPct) + '</td>' +
                    '<td class="pc-num"><span class="pc-price-val">' + fmtMoney(price) + '</span></td>' +
                '</tr>';
        });

        html += '</tbody></table>';
        tbodyContainer.innerHTML = html;
        updateCheckedCounter();
        updateSelectedProductBottomBanner();
    }

    // ========================================================================
    // SELECCIÓN Y MARCADO CON BARRA ESPACIADORA (ESPACIO)
    // ========================================================================
    function selectRow(sku, scrollIntoView) {
        if (!sku) return;
        _selectedSku = sku;
        var rows = document.querySelectorAll('#products-table-body .pc-row');
        var activeRow = null;
        rows.forEach(function (r) {
            var isMatch = r.getAttribute('data-sku') === sku;
            r.classList.toggle('sel', isMatch);
            if (isMatch) activeRow = r;
        });
        if (scrollIntoView && activeRow && typeof activeRow.scrollIntoView === 'function') {
            activeRow.scrollIntoView({ block: 'nearest' });
        }
        updateCheckedCounter();
        updateSelectedProductBottomBanner();
    }

    function toggleCheckSku(sku) {
        var target = sku || _selectedSku;
        if (!target) return;
        if (_checked.has(target)) {
            _checked.delete(target);
        } else {
            _checked.add(target);
        }
        // Actualizar fila visualmente sin re-renderizar toda la tabla
        var rows = document.querySelectorAll('#products-table-body .pc-row');
        rows.forEach(function (r) {
            if (r.getAttribute('data-sku') === target) {
                var isChk = _checked.has(target);
                r.classList.toggle('chk-row', isChk);
                var cb = r.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = isChk;
            }
        });
        updateCheckedCounter();
    }

    function getSelectedProduct() {
        return _filtered.find(function (p) { return p.sku === _selectedSku; }) ||
               _allProducts.find(function (p) { return p.sku === _selectedSku; }) ||
               _filtered[0] ||
               null;
    }

    // ========================================================================
    // ACCIONES DE BARRA SUPERIOR Y MODALES
    // ========================================================================

    // 1. NUEVO PRODUCTO [INS]
    function goAlta(prod) {
        var isEditMode = Boolean(prod && prod.sku);
        // Editar [ENTER] => Modo Edición con el producto seleccionado | Nuevo [INS] => Modo Nuevo Registro
        global._isEditingExistingProduct = isEditMode;
        global._productoAltaEdit = isEditMode ? prod : null;
        global._paEditRequest = isEditMode ? { sku: String(prod.sku), id: prod.id || null, ts: Date.now() } : null;
        if (!isEditMode) {
            global._paLoadedExistingProduct = null;
        }
        // Aislamiento por artículo: nunca arrastrar escalas / ofertas del producto anterior a la pantalla que se abre
        global._paProductPriceScales = null;
        global._paProductBranchScales = null;
        global._paProductOffers = [];
        try {
            if (isEditMode) {
                sessionStorage.setItem('calebsys_edit_product_sku', String(prod.sku));
            } else {
                sessionStorage.removeItem('calebsys_edit_product_sku');
            }
        } catch (e) {}
        if (typeof global.navigateTo === 'function') {
            global.navigateTo('producto-alta');
        } else {
            window.location.hash = '#producto-alta';
        }
    }

    // 2. EDITAR PRODUCTO [ENTER]
    function editSelected(skuOverride) {
        var p = skuOverride
            ? (_allProducts.find(function (x) { return x.sku === skuOverride; }) || getSelectedProduct())
            : getSelectedProduct();
        if (!p) {
            if (typeof global.showToast === 'function') global.showToast('Selecciona primero un producto de la tabla.', 'warning');
            return;
        }
        if (typeof global.closeModal === 'function') {
            global.closeModal('modal-pc-existencias');
            global.closeModal('modal-detalle-producto');
        }
        if (isPackageKit(p) && typeof global.pktF10EditSaved === 'function') {
            openPaquetesModalF10(p.sku);
            return;
        }
        goAlta(p);
    }

    // 3. ELIMINAR PRODUCTO(S) [DEL / SUPR]
    async function deleteSelectedProducts() {
        var skusToDelete = _checked.size > 0
            ? Array.from(_checked)
            : (_selectedSku ? [_selectedSku] : []);

        if (skusToDelete.length === 0) {
            if (typeof global.showToast === 'function') global.showToast('Selecciona o marca con ESPACIO al menos un producto para eliminar.', 'warning');
            return;
        }

        var names = skusToDelete.map(function (s) {
            var found = _allProducts.find(function (x) { return x.sku === s; });
            return found ? (found.sku + ' — ' + found.name) : s;
        });

        var msg = skusToDelete.length === 1
            ? '¿Estás seguro de eliminar el producto:\n\n' + names[0] + '?'
            : '¿Estás seguro de eliminar los ' + skusToDelete.length + ' productos marcados con ESPACIO?\n\n• ' + names.slice(0, 6).join('\n• ') + (names.length > 6 ? '\n...' : '');

        if (!window.confirm(msg)) return;

        var deletedCount = 0;
        for (var i = 0; i < skusToDelete.length; i++) {
            var sku = skusToDelete[i];
            try {
                var res = await fetch('/api/products/' + encodeURIComponent(sku), {
                    method: 'DELETE',
                    credentials: 'include'
                });
                if (res.ok) {
                    deletedCount++;
                    _checked.delete(sku);
                }
            } catch (e) {
                console.error('[CALEBSYS] Error eliminando SKU ' + sku + ':', e);
            }
        }

        if (deletedCount > 0) {
            if (typeof global.showToast === 'function') {
                global.showToast(deletedCount === 1 ? 'Producto eliminado correctamente.' : (deletedCount + ' productos eliminados correctamente.'), 'success');
            }
            var q = (document.getElementById('products-search-input') || {}).value || '';
            await loadProducts(q.trim());
        } else {
            if (typeof global.showToast === 'function') {
                global.showToast('No se pudo eliminar el producto seleccionado.', 'error');
            }
        }
    }

    // 4, 5, 6. FILTROS RÁPIDOS: FAMILIA [F4], DEPARTAMENTO [F5], MARCA [F6]
    function openQuickFilterModal(mode) {
        _qfMode = mode; // 'familia' | 'depto' | 'marca'
        var titleEl = document.getElementById('pc-qf-title');
        var searchEl = document.getElementById('pc-qf-search');

        if (mode === 'familia') {
            if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-layer-group" style="color:var(--brand-400);margin-right:8px;"></i>Filtrar por Familia [F4]';
            _qfOptions = Array.from(new Set(_allProducts.map(getFamilia).filter(Boolean))).sort();
        } else if (mode === 'depto') {
            if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-sitemap" style="color:var(--brand-400);margin-right:8px;"></i>Filtrar por Departamento [F5]';
            _qfOptions = Array.from(new Set(_allProducts.map(getDepto).filter(Boolean))).sort();
        } else {
            if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-tag" style="color:var(--brand-400);margin-right:8px;"></i>Filtrar por Marca [F6]';
            _qfOptions = Array.from(new Set(_allProducts.map(getMarca).filter(Boolean))).sort();
        }

        if (searchEl) searchEl.value = '';
        renderQuickFilterList('');

        if (typeof global.openModal === 'function') {
            global.openModal('modal-pc-quick-filter');
        } else {
            var m = document.getElementById('modal-pc-quick-filter');
            if (m) m.classList.add('open');
        }
        setTimeout(function () {
            if (searchEl) searchEl.focus();
        }, 60);
    }

    function renderQuickFilterList(query) {
        var listEl = document.getElementById('pc-qf-list');
        if (!listEl) return;
        var q = String(query || '').trim().toUpperCase();

        var selectId = _qfMode === 'familia' ? 'pc-f-familia' : (_qfMode === 'depto' ? 'pc-f-depto' : 'pc-f-marca');
        var currentVal = (document.getElementById(selectId) || {}).value || '';

        var filteredOpts = _qfOptions.filter(function (item) {
            return !q || item.toUpperCase().indexOf(q) !== -1;
        });

        var html =
            '<button type="button" class="pc-fmodal-item' + (!currentVal ? ' active' : '') + '" data-click="productsQuickFilterPick" data-click-arg="">' +
                '<span><i class="fa-solid fa-border-all" style="margin-right:8px;"></i>MOSTRAR TODOS (Sin filtro)</span>' +
                '<span class="badge badge-neutral">' + _allProducts.length + '</span>' +
            '</button>';

        filteredOpts.forEach(function (opt) {
            var count = _allProducts.filter(function (p) {
                var val = _qfMode === 'familia' ? getFamilia(p) : (_qfMode === 'depto' ? getDepto(p) : getMarca(p));
                return val === opt;
            }).length;
            var isAct = currentVal === opt;
            html +=
                '<button type="button" class="pc-fmodal-item' + (isAct ? ' active' : '') + '" data-click="productsQuickFilterPick" data-click-arg="' + escapeHtml(opt) + '">' +
                    '<span>' + escapeHtml(opt) + '</span>' +
                    '<span class="badge badge-neutral">' + count + ' prod.</span>' +
                '</button>';
        });

        listEl.innerHTML = html;
    }

    function pickQuickFilterValue(val) {
        var selectId = _qfMode === 'familia' ? 'pc-f-familia' : (_qfMode === 'depto' ? 'pc-f-depto' : 'pc-f-marca');
        var sel = document.getElementById(selectId);
        if (sel) sel.value = val || '';

        if (typeof global.closeModal === 'function') {
            global.closeModal('modal-pc-quick-filter');
        } else {
            var m = document.getElementById('modal-pc-quick-filter');
            if (m) m.classList.remove('open');
        }
        applyClientFilters();
    }

    // 8. MODAL DE EXISTENCIAS POR SUCURSAL [F8 / STOCK]
    async function openStockPorSucursalModal(skuOverride) {
        var p = skuOverride
            ? (_allProducts.find(function (x) { return x.sku === skuOverride; }) || getSelectedProduct())
            : getSelectedProduct();

        if (!p) {
            if (typeof global.showToast === 'function') global.showToast('Selecciona un producto para consultar sus existencias por sucursal.', 'warning');
            return;
        }

        _selectedSku = p.sku;
        selectRow(p.sku, false);

        var nameEl = document.getElementById('pc-ex-prod-name');
        var skuEl = document.getElementById('pc-ex-prod-sku');
        var tbodyEl = document.getElementById('pc-ex-tbody');
        var totalValEl = document.getElementById('pc-ex-total-val');
        var totalUnitEl = document.getElementById('pc-ex-total-unit');
        var compEl = document.getElementById('pc-ex-comprometido-info');

        var unitLbl = (p.sale_unit || 'PZA').toUpperCase();
        if (nameEl) nameEl.textContent = (p.name || p.description || p.sku).toUpperCase();
        if (skuEl) skuEl.textContent = 'SKU: ' + p.sku;
        if (totalUnitEl) totalUnitEl.textContent = unitLbl;
        if (totalValEl) totalValEl.textContent = fmtQty(p.stock || 0);
        if (compEl) compEl.textContent = '';

        if (tbodyEl) {
            tbodyEl.innerHTML =
                '<tr><td colspan="3" style="text-align:center;padding:22px;color:var(--text-muted);">' +
                    '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> Consultando existencias reales por sucursal...' +
                '</td></tr>';
        }

        if (typeof global.openModal === 'function') {
            global.openModal('modal-pc-existencias');
        } else {
            var m = document.getElementById('modal-pc-existencias');
            if (m) m.classList.add('open');
        }

        try {
            var res = await fetch('/api/products-f3/detail?sku=' + encodeURIComponent(p.sku), { credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();

            var warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
            var totalSum = 0;

            if (warehouses.length === 0) {
                totalSum = parseFloat(p.stock) || 0;
                if (tbodyEl) {
                    tbodyEl.innerHTML =
                        '<tr class="pc-ex-row-main">' +
                            '<td><i class="fa-solid fa-building-columns" style="color:var(--brand-400);margin-right:8px;"></i>BODEGA / MATRIZ PRINCIPAL</td>' +
                            '<td style="text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:14px;">' + fmtQty(totalSum) + '</td>' +
                            '<td style="text-align:center;">' + escapeHtml(unitLbl) + '</td>' +
                        '</tr>';
                }
            } else {
                var rowsHtml = '';
                warehouses.forEach(function (w, idx) {
                    var qty = parseFloat(w.fisico) || 0;
                    totalSum += qty;
                    var isMain = idx === 0 || String(w.key || '').toUpperCase() === 'MATRIZ';
                    var qtyColor = qty <= 0 ? 'var(--pc-low)' : (qty <= (parseFloat(w.min) || 5) ? 'var(--pc-mid)' : 'var(--pc-ok)');
                    rowsHtml +=
                        '<tr class="' + (isMain ? 'pc-ex-row-main' : '') + '">' +
                            '<td>' +
                                '<i class="fa-solid ' + (isMain ? 'fa-building-columns' : 'fa-store') + '" style="color:' + (isMain ? 'var(--brand-400)' : 'var(--text-secondary)') + ';margin-right:8px;"></i>' +
                                escapeHtml((w.nombre || w.key || 'SUCURSAL').toUpperCase()) +
                                (isMain ? ' <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(59,130,246,.16);color:var(--brand-400);margin-left:6px;font-weight:800;">MATRIZ</span>' : '') +
                            '</td>' +
                            '<td style="text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:14.5px;color:' + qtyColor + ';">' +
                                fmtQty(qty) +
                            '</td>' +
                            '<td style="text-align:center;color:var(--text-secondary);font-size:12px;">' +
                                escapeHtml(unitLbl) +
                            '</td>' +
                        '</tr>';
                });
                if (tbodyEl) tbodyEl.innerHTML = rowsHtml;
            }

            if (totalValEl) totalValEl.textContent = fmtQty(totalSum);
            var comp = parseFloat(data.comprometido) || 0;
            if (compEl) {
                compEl.innerHTML = comp > 0
                    ? '<i class="fa-solid fa-lock" style="color:#fbbf24;margin-right:4px;"></i> En resguardo POS: <b>' + fmtQty(comp) + ' ' + escapeHtml(unitLbl) + '</b>'
                    : '<i class="fa-solid fa-circle-check" style="color:#10b981;margin-right:4px;"></i> Sin mercancía comprometida';
            }
        } catch (err) {
            console.error('[CALEBSYS] Error consultando existencias por sucursal:', err);
            if (tbodyEl) {
                tbodyEl.innerHTML =
                    '<tr class="pc-ex-row-main">' +
                        '<td><i class="fa-solid fa-building-columns" style="color:var(--brand-400);margin-right:8px;"></i>MATRIZ (Sede Principal)</td>' +
                        '<td style="text-align:right;font-family:ui-monospace,Consolas,monospace;font-size:14px;">' + fmtQty(p.stock || 0) + '</td>' +
                        '<td style="text-align:center;">' + escapeHtml(unitLbl) + '</td>' +
                    '</tr>';
            }
        }
    }

    // ========================================================================
    // 10. MODAL DE KARDEX POR PRODUCTO(S) SELECCIONADO(S) [F12]
    //     + NAVEGACIÓN ↑/↓, MARCADO CON [ESPACIO], VISOR DE DOCUMENTO [ENTER]
    //     + MODALES CENTRADOS CON DISEÑO CALEBSYS (SIN ALERT/PROMPT NATIVOS)
    // ========================================================================
    var _kdxFilteredRows = [];
    var _kdxActiveIndex = 0;
    var _kdxCheckedIds = new Set();
    var _kdxSendChannel = 'WHATSAPP';
    var _kdxActiveDocData = null;
    var _kdxSigCanvasBound = false;
    var _kdxSigHasDrawn = false;

    function _focusKardexTableIfOpen() {
        if (!_isModalOpenById('modal-pc-kardex')) return;
        if (_isModalOpenById('modal-pc-kdx-doc') || _isModalOpenById('modal-pc-kdx-send') || _isModalOpenById('modal-pc-alert')) return;
        var searchInp = document.getElementById('products-search-input');
        if (searchInp && document.activeElement === searchInp) {
            try { searchInp.blur(); } catch (e) {}
        }
        var wrap = document.getElementById('pc-kdx-table-wrap');
        if (wrap) {
            try { wrap.focus({ preventScroll: true }); } catch (e) {
                try { wrap.focus(); } catch (e2) {}
            }
        }
    }

    function _openModalById(id) {
        var searchInp = document.getElementById('products-search-input');
        if (searchInp && document.activeElement === searchInp) {
            try { searchInp.blur(); } catch (e) {}
        }
        if (typeof global.openModal === 'function') {
            global.openModal(id);
        }
        var m = document.getElementById(id);
        if (m) m.classList.add('open');
        if (id === 'modal-pc-kardex') {
            setTimeout(_focusKardexTableIfOpen, 20);
        }
    }

    function _closeModalById(id) {
        if (typeof global.closeModal === 'function') {
            global.closeModal(id);
        }
        var m = document.getElementById(id);
        if (m) m.classList.remove('open', 'active');
        if (id !== 'modal-pc-kardex' && _isModalOpenById('modal-pc-kardex')) {
            setTimeout(_focusKardexTableIfOpen, 20);
        }
    }

    function _isModalOpenById(id) {
        var el = document.getElementById(id);
        return Boolean(el && (el.classList.contains('open') || el.classList.contains('active')));
    }

    function showCalebsysAlertModal(title, message, subtitle) {
        var tEl = document.getElementById('pc-alert-title');
        var mEl = document.getElementById('pc-alert-msg');
        var sEl = document.getElementById('pc-alert-sub');
        if (tEl) tEl.textContent = title || 'Aviso del Sistema';
        if (mEl) mEl.textContent = message || 'No hay productos seleccionados';
        if (sEl && subtitle !== undefined) sEl.innerHTML = subtitle;
        _openModalById('modal-pc-alert');
        setTimeout(function () {
            var btn = document.getElementById('pc-alert-ok-btn');
            if (btn) btn.focus();
        }, 40);
    }

    function _getKdxRowKey(r, idxFallback) {
        if (!r) return String(idxFallback || 0);
        return String(r.id || r.movementId || '') + '::' + String(r.sku || '') + '::' + String(r.folio || '') + '::' + String(r.fecha || '');
    }

    function _extractMovIsoDate(m) {
        if (!m) return '';
        var raw = String(m.isoDate || m.fecha || '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
            return raw.slice(0, 10);
        }
        var dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (dmy) {
            return dmy[3] + '-' + dmy[2] + '-' + dmy[1];
        }
        return '';
    }

    function getKardexSelectedProductsList() {
        var skus = Array.isArray(_kdxData.selectedSkus) ? _kdxData.selectedSkus : [];
        var skuMap = {};
        skus.forEach(function (s) {
            if (s) skuMap[String(s).trim().toUpperCase()] = true;
        });
        var result = [];
        var seen = {};
        (_kdxData.products || []).concat(_allProducts || []).forEach(function (p) {
            if (!p || !p.sku) return;
            var k = String(p.sku).trim().toUpperCase();
            if (skuMap[k] && !seen[k]) {
                seen[k] = true;
                result.push(p);
            }
        });
        return result;
    }

    async function openKardexModal(explicitSkuList) {
        var selectedSkus = [];
        if (Array.isArray(explicitSkuList) && explicitSkuList.length > 0) {
            selectedSkus = explicitSkuList.filter(Boolean);
        } else if (typeof explicitSkuList === 'string' && explicitSkuList && explicitSkuList !== 'ALL') {
            selectedSkus = [explicitSkuList];
        } else if (_checked.size > 0) {
            selectedSkus = Array.from(_checked);
        }

        if (selectedSkus.length === 0) {
            showCalebsysAlertModal(
                'Sin Productos Seleccionados',
                'No hay productos seleccionados',
                'Marque uno o más productos en su casilla <kbd style="padding:1px 5px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card-2);">[x]</kbd> o con la barra <kbd style="padding:1px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card-2);font-weight:800;">ESPACIO</kbd> para consultar su Kardex [F12].'
            );
            return;
        }

        _kdxData.selectedSkus = selectedSkus.map(function (s) { return String(s).trim().toUpperCase(); });
        _kdxCheckedIds.clear();
        _kdxActiveIndex = 0;

        var tbodyEl = document.getElementById('pc-kdx-tbody');
        if (tbodyEl) {
            tbodyEl.innerHTML =
                '<tr><td colspan="12" style="text-align:center;padding:28px;color:var(--text-muted);">' +
                    '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> Cargando Kardex de productos seleccionados...' +
                '</td></tr>';
        }

        _openModalById('modal-pc-kardex');

        try {
            var res = await fetch('/api/products-f3/kardex-global', { credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();

            _kdxData.branches = Array.isArray(data.branches) ? data.branches : [];
            _kdxData.products = Array.isArray(data.products) ? data.products : [];
            _kdxData.movements = Array.isArray(data.movements) ? data.movements : [];

            populateKardexSelectors();
            renderKardexRows();
        } catch (err) {
            console.error('[CALEBSYS] Error cargando Kardex:', err);
            if (tbodyEl) {
                tbodyEl.innerHTML =
                    '<tr><td colspan="12" style="text-align:center;padding:24px;color:var(--danger);">' +
                        'No se pudo cargar el Kardex (' + escapeHtml(err.message) + ')' +
                    '</td></tr>';
            }
        }
    }

    function populateKardexSelectors() {
        var prodSel = document.getElementById('pc-kdx-product');
        var scopeSel = document.getElementById('pc-kdx-scope');
        var selectedProducts = getKardexSelectedProductsList();

        if (prodSel) {
            var opts = '';
            if (selectedProducts.length > 1) {
                opts += '<option value="SELECTED_ALL"> TODOS LOS SELECCIONADOS (' + selectedProducts.length + ' productos)</option>';
            }
            selectedProducts.forEach(function (p) {
                opts += '<option value="' + escapeHtml(p.sku) + '">' + escapeHtml(p.sku) + ' - ' + escapeHtml(p.name || p.description || p.sku) + ' (Stock: ' + fmtQty(p.stock) + ')</option>';
            });
            prodSel.innerHTML = opts;
            prodSel.value = selectedProducts.length > 1 ? 'SELECTED_ALL' : (selectedProducts[0] ? selectedProducts[0].sku : '');
        }

        if (scopeSel) {
            var curScope = scopeSel.value || 'AMBAS';
            var sOpts =
                '<option value="AMBAS"> AMBAS (Matriz + Todas las Sucursales)</option>' +
                '<option value="MATRIZ"> SOLO MATRIZ (Sede Principal)</option>' +
                '<option value="SUCURSALES"> SOLO SUCURSALES FORÁNEAS</option>';
            _kdxData.branches.forEach(function (b) {
                sOpts += '<option value="BRANCH:' + escapeHtml(b.key) + '"> Sucursal: ' + escapeHtml(b.nombre || b.key) + '</option>';
            });
            scopeSel.innerHTML = sOpts;
            scopeSel.value = curScope;
        }
    }

    function getFilteredKardexMovements() {
        var prodFilter = (document.getElementById('pc-kdx-product') || {}).value || 'SELECTED_ALL';
        var scopeFilter = (document.getElementById('pc-kdx-scope') || {}).value || 'AMBAS';
        var flowFilter = (document.getElementById('pc-kdx-flow') || {}).value || 'ALL';
        var q = String((document.getElementById('pc-kdx-search') || {}).value || '').trim().toUpperCase();
        var dateFrom = String((document.getElementById('pc-kdx-date-from') || {}).value || '').trim();
        var dateTo = String((document.getElementById('pc-kdx-date-to') || {}).value || '').trim();

        var allowedSkuSet = {};
        (_kdxData.selectedSkus || []).forEach(function (s) {
            allowedSkuSet[String(s).trim().toUpperCase()] = true;
        });

        var seenRowDedup = {};
        return _kdxData.movements.filter(function (m) {
            var mSku = String(m.sku || '').trim().toUpperCase();
            if (!allowedSkuSet[mSku]) return false;
            if (prodFilter && prodFilter !== 'SELECTED_ALL' && prodFilter !== 'ALL') {
                if (mSku !== String(prodFilter).trim().toUpperCase()) return false;
            }

            if (dateFrom || dateTo) {
                var mIso = _extractMovIsoDate(m);
                if (dateFrom && (!mIso || mIso < dateFrom)) return false;
                if (dateTo && (!mIso || mIso > dateTo)) return false;
            }

            var isMain = Boolean(m.isMainBranch || String(m.almacenKey || '').toUpperCase() === 'MATRIZ');
            if (scopeFilter === 'MATRIZ' && !isMain) return false;
            if (scopeFilter === 'SUCURSALES' && isMain) return false;
            if (scopeFilter.indexOf('BRANCH:') === 0) {
                var targetKey = scopeFilter.slice(7).toUpperCase();
                if (String(m.almacenKey || '').toUpperCase() !== targetKey) return false;
            }

            var entrada = parseFloat(m.entrada) || 0;
            var salida = parseFloat(m.salida) || 0;
            if (flowFilter === 'ENTRADA' && entrada <= 0) return false;
            if (flowFilter === 'SALIDA' && salida <= 0) return false;
            if (flowFilter === 'TRASLADO' && m.tipo !== 'TRASLADO') return false;

            if (q) {
                var hay = [m.folio, m.sku, m.productName, m.concepto, m.docTipoLabel, m.almacenNombre, m.usuario]
                    .map(function (x) { return String(x || '').toUpperCase(); })
                    .join(' ');
                if (hay.indexOf(q) === -1) return false;
            }

            var dKey = mSku + '|' + String(m.folio || '') + '|' + String(m.tipo || '') + '|' + String(m.fecha || '') + '|' + entrada + '|' + salida;
            if (seenRowDedup[dKey]) return false;
            seenRowDedup[dKey] = true;

            return true;
        });
    }

    function _updateKardexSelectionBadge() {
        var badgeEl = document.getElementById('pc-kdx-sel-badge');
        var chkAll = document.getElementById('pc-kdx-chk-all');
        var count = 0;
        _kdxFilteredRows.forEach(function (r, idx) {
            if (_kdxCheckedIds.has(_getKdxRowKey(r, idx))) count++;
        });
        if (badgeEl) {
            badgeEl.textContent = count > 0
                ? (count + (count === 1 ? ' movimiento marcado [ESP]' : ' movimientos marcados [ESP]'))
                : '0 marcados (usa ESPACIO o casilla de seleccion)';
        }
        if (chkAll) {
            chkAll.checked = _kdxFilteredRows.length > 0 && count === _kdxFilteredRows.length;
        }
    }

    function renderKardexRows() {
        var tbodyEl = document.getElementById('pc-kdx-tbody');
        if (!tbodyEl) return;

        var rows = getFilteredKardexMovements();
        _kdxFilteredRows = rows;
        if (_kdxActiveIndex >= rows.length) {
            _kdxActiveIndex = Math.max(0, rows.length - 1);
        }

        var totalIn = 0;
        var totalOut = 0;
        var netVal = 0;
        rows.forEach(function (r) {
            totalIn += parseFloat(r.entrada) || 0;
            totalOut += parseFloat(r.salida) || 0;
            netVal += parseFloat(r.totalMov) || 0;
        });

        var setTxt = function (id, v) {
            var el = document.getElementById(id);
            if (el) el.textContent = v;
        };
        setTxt('pc-kdx-kpi-count', rows.length);
        setTxt('pc-kdx-kpi-in', '+' + fmtQty(totalIn));
        setTxt('pc-kdx-kpi-out', '-' + fmtQty(totalOut));
        setTxt('pc-kdx-kpi-val', fmtMoney(netVal));

        if (rows.length === 0) {
            tbodyEl.innerHTML =
                '<tr><td colspan="12" style="text-align:center;padding:28px;color:var(--text-muted);">' +
                    '<i class="fa-solid fa-box-open" style="margin-right:6px;"></i> No hay movimientos que coincidan con los filtros seleccionados.' +
                '</td></tr>';
            _updateKardexSelectionBadge();
            return;
        }

        var html = '';
        rows.forEach(function (r, idx) {
            var ent = parseFloat(r.entrada) || 0;
            var sal = parseFloat(r.salida) || 0;
            var isMain = Boolean(r.isMainBranch || String(r.almacenKey || '').toUpperCase() === 'MATRIZ');
            var docColor = r.tipo === 'ENTRADA' ? '#10b981' : (r.tipo === 'SALIDA' ? '#f87171' : '#60a5fa');
            var rowKey = _getKdxRowKey(r, idx);
            var isChk = _kdxCheckedIds.has(rowKey);
            var isSel = idx === _kdxActiveIndex;

            html +=
                '<tr class="pc-row' + (isSel ? ' sel' : '') + (isChk ? ' chk-row' : '') + '" ' +
                    'data-kdx-idx="' + idx + '" ' +
                    'data-click="productsKardexSelectRow" data-click-arg="' + idx + '" ' +
                    'data-dblclick="productsKardexOpenDocByIdx" data-dblclick-arg="' + idx + '" ' +
                    'style="cursor:pointer;">' +
                    '<td class="pc-chk" style="text-align:center;">' +
                        '<input type="checkbox" class="pc-chk" data-change="productsKardexToggleRowCheck" data-change-arg="' + idx + '"' + (isChk ? ' checked' : '') + '>' +
                    '</td>' +
                    '<td style="font-size:11.5px;color:var(--text-secondary);">' + escapeHtml(r.fecha || r.isoDate) + '</td>' +
                    '<td class="pc-mono" style="font-weight:800;">' +
                        '<span data-click="productsKardexOpenDocByIdx" data-click-arg="' + idx + '" ' +
                              'style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:var(--brand-400);cursor:pointer;" ' +
                              'title="Presiona ENTER o haz clic para ver el Documento Final Guardado">' +
                            '<i class="fa-solid fa-file-invoice" style="font-size:11px;"></i> ' + escapeHtml(r.folio) +
                        '</span>' +
                    '</td>' +
                    '<td>' +
                        '<div style="font-weight:700;color:var(--text-primary);">' + escapeHtml(r.productName) + '</div>' +
                        '<div style="font-size:10.5px;color:var(--brand-400);font-family:ui-monospace,Consolas,monospace;">SKU: ' + escapeHtml(r.sku) + '</div>' +
                    '</td>' +
                    '<td>' +
                        '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:' + (isMain ? 'rgba(59,130,246,.14)' : 'rgba(168,85,247,.14)') + ';color:' + (isMain ? 'var(--brand-400)' : '#c084fc') + ';">' +
                            '<i class="fa-solid ' + (isMain ? 'fa-building-columns' : 'fa-store') + '"></i> ' +
                            escapeHtml(r.almacenNombre || r.almacenKey) +
                        '</span>' +
                    '</td>' +
                    '<td><span style="font-size:11px;font-weight:800;color:' + docColor + ';">' + escapeHtml(r.docTipoLabel || r.tipo) + '</span></td>' +
                    '<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;" title="' + escapeHtml(r.obs || r.concepto) + '">' + escapeHtml(r.concepto) + '</td>' +
                    '<td style="text-align:right;font-family:ui-monospace,Consolas,monospace;font-weight:800;color:#10b981;">' + (ent > 0 ? ('+' + fmtQty(ent)) : '-') + '</td>' +
                    '<td style="text-align:right;font-family:ui-monospace,Consolas,monospace;font-weight:800;color:#f87171;">' + (sal > 0 ? ('-' + fmtQty(sal)) : '-') + '</td>' +
                    '<td style="text-align:right;font-family:ui-monospace,Consolas,monospace;font-weight:800;">' + fmtQty(r.saldo) + ' <small style="color:var(--text-muted);">' + escapeHtml(r.unit || 'PZA') + '</small></td>' +
                    '<td style="text-align:right;font-family:ui-monospace,Consolas,monospace;">' + fmtMoney(r.costoUnit) + '</td>' +
                    '<td style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(r.usuario || 'ADMIN') + '</td>' +
                '</tr>';
        });

        tbodyEl.innerHTML = html;
        _updateKardexSelectionBadge();
        var act = document.activeElement;
        var kdxModal = document.getElementById('modal-pc-kardex');
        if (!act || act === document.body || act.id === 'products-search-input' || (kdxModal && !kdxModal.contains(act))) {
            _focusKardexTableIfOpen();
        }
    }

    function selectKardexRowByIndex(idx, scrollIntoView) {
        if (!_kdxFilteredRows.length) return;
        var cleanIdx = Math.max(0, Math.min(_kdxFilteredRows.length - 1, parseInt(idx, 10) || 0));
        _kdxActiveIndex = cleanIdx;
        var rows = document.querySelectorAll('#pc-kdx-tbody tr[data-kdx-idx]');
        var activeTr = null;
        rows.forEach(function (tr) {
            var isMatch = parseInt(tr.getAttribute('data-kdx-idx'), 10) === cleanIdx;
            tr.classList.toggle('sel', isMatch);
            if (isMatch) activeTr = tr;
        });
        if (scrollIntoView && activeTr && typeof activeTr.scrollIntoView === 'function') {
            activeTr.scrollIntoView({ block: 'nearest' });
        }
    }

    function toggleKardexRowCheckByIndex(idx, forcedState) {
        if (!_kdxFilteredRows.length) return;
        var cleanIdx = Math.max(0, Math.min(_kdxFilteredRows.length - 1, parseInt(idx, 10) || 0));
        var rowObj = _kdxFilteredRows[cleanIdx];
        if (!rowObj) return;
        var key = _getKdxRowKey(rowObj, cleanIdx);
        var nextState = forcedState !== undefined ? Boolean(forcedState) : !_kdxCheckedIds.has(key);
        if (nextState) _kdxCheckedIds.add(key);
        else _kdxCheckedIds.delete(key);

        var tr = document.querySelector('#pc-kdx-tbody tr[data-kdx-idx="' + cleanIdx + '"]');
        if (tr) {
            tr.classList.toggle('chk-row', nextState);
            var chk = tr.querySelector('input[type="checkbox"]');
            if (chk) chk.checked = nextState;
        }
        _updateKardexSelectionBadge();
    }

    function getKardexTargetRowsForReport() {
        var allRows = getFilteredKardexMovements();
        if (_kdxCheckedIds.size === 0) return allRows;
        var checkedRows = allRows.filter(function (r, idx) {
            return _kdxCheckedIds.has(_getKdxRowKey(r, idx));
        });
        return checkedRows.length > 0 ? checkedRows : allRows;
    }

    // ========================================================================
    // VISOR DE DOCUMENTO FINAL GUARDADO AL PRESIONAR [ENTER] EN EL KARDEX
    // ========================================================================
    function _buildStylizedSignatureSvg(signerName, dateStr) {
        var cleanName = String(signerName || 'FIRMA DE CONFORMIDAD').trim();
        return (
            '<svg viewBox="0 0 420 110" width="100%" height="95" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;">' +
                '<defs>' +
                    '<linearGradient id="sigInk" x1="0%" y1="0%" x2="100%" y2="0%">' +
                        '<stop offset="0%" stop-color="#1d4ed8"/>' +
                        '<stop offset="100%" stop-color="#0f172a"/>' +
                    '</linearGradient>' +
                '</defs>' +
                '<path d="M 32 76 C 65 22, 95 88, 132 44 C 155 18, 170 79, 206 52 C 235 30, 260 74, 302 48 C 332 29, 360 66, 392 40" ' +
                      'fill="none" stroke="url(#sigInk)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>' +
                '<path d="M 54 84 Q 195 66 368 78" fill="none" stroke="#2563eb" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/>' +
                '<text x="210" y="58" text-anchor="middle" fill="#1e3a8a" font-family="Georgia, serif" font-style="italic" font-weight="bold" font-size="18" opacity="0.92">' +
                    escapeHtml(cleanName.slice(0, 34)) +
                '</text>' +
                '<text x="210" y="102" text-anchor="middle" fill="#64748b" font-family="monospace" font-size="9.5">' +
                    'SELLO DIGITAL CALEBSYS · ' + escapeHtml(dateStr || '') +
                '</text>' +
            '</svg>'
        );
    }

    async function openKardexDocumentModal(rowObj) {
        if (!rowObj) {
            if (_kdxFilteredRows.length > 0) {
                rowObj = _kdxFilteredRows[_kdxActiveIndex] || _kdxFilteredRows[0];
            }
        }
        if (!rowObj) {
            showCalebsysAlertModal('Sin Movimiento Seleccionado', 'Seleccione un movimiento en la tabla del Kardex para consultar su documento.', '');
            return;
        }

        var bodyEl = document.getElementById('pc-kdoc-body');
        var titleEl = document.getElementById('pc-kdoc-title');
        var folioBadge = document.getElementById('pc-kdoc-folio-badge');
        var statusBadge = document.getElementById('pc-kdoc-status-badge');
        if (titleEl) titleEl.textContent = (rowObj.docTipoLabel || 'DOCUMENTO DE KARDEX').toUpperCase();
        if (folioBadge) folioBadge.textContent = rowObj.folio || 'S/F';
        if (statusBadge) statusBadge.textContent = 'CONSULTANDO...';

        if (bodyEl) {
            bodyEl.innerHTML =
                '<div style="padding:40px;text-align:center;color:var(--text-muted);">' +
                    '<i class="fa-solid fa-spinner fa-spin" style="font-size:24px;color:var(--brand-400);margin-bottom:10px;display:block;"></i>' +
                    'Reconstruyendo documento final guardado (' + escapeHtml(rowObj.folio || '') + ')...' +
                '</div>';
        }

        _openModalById('modal-pc-kdx-doc');

        try {
            var qs = 'mov_id=' + encodeURIComponent(rowObj.id || '') +
                     '&folio=' + encodeURIComponent(rowObj.folio || '') +
                     '&sku=' + encodeURIComponent(rowObj.sku || '');
            var res = await fetch('/api/products-f3/kardex-document?' + qs, { credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var docData = await res.json();
            _kdxActiveDocData = docData;
            renderKardexDocumentView(docData);
        } catch (err) {
            console.error('[CALEBSYS] Error cargando documento de Kardex:', err);
            // Fallback con los datos del renglón por si es un movimiento local sin entidad extendida
            var fallbackDoc = {
                ok: true,
                doc_key: String(rowObj.folio || rowObj.id || 'DOC'),
                doc_category: rowObj.tipo || 'MOVIMIENTO',
                doc_type_label: rowObj.docTipoLabel || 'DOCUMENTO DE INVENTARIO',
                folio: rowObj.folio || 'S/F',
                status: 'GUARDADO EN KARDEX',
                fecha_emision: rowObj.fecha || rowObj.isoDate || '',
                sucursal_origen: rowObj.almacenNombre || rowObj.almacenKey || 'MATRIZ',
                sucursal_entrega: rowObj.almacenNombre || rowObj.almacenKey || 'MATRIZ',
                canal_venta: rowObj.docTipoLabel || 'KARDEX',
                vendedor: rowObj.usuario || 'ADMIN',
                client: {
                    name: rowObj.concepto || 'MOVIMIENTO INTERNO DE ALMACÉN',
                    code: rowObj.sku || 'S/C',
                    rfc: 'XAXX010101000',
                    client_type: rowObj.docTipoLabel || 'OPERACIÓN',
                    price_scale: 'PRECIO / COSTO KARDEX',
                    phone: 'S/TEL',
                    email: '',
                    address: rowObj.almacenNombre || 'MATRIZ'
                },
                payment: {
                    method: rowObj.docTipoLabel || 'OPERACIÓN REGISTRADA',
                    is_credit: false,
                    reference: rowObj.folio || 'S/REF',
                    subtotal: Math.abs(parseFloat(rowObj.totalMov) || 0),
                    discount: 0,
                    tax: 0,
                    total: Math.abs(parseFloat(rowObj.totalMov) || 0),
                    amount_paid: Math.abs(parseFloat(rowObj.totalMov) || 0),
                    change_returned: 0,
                    advance: 0
                },
                credit_info: { is_credit: false, abonos: [] },
                delivery_info: {
                    quien_llevo: rowObj.usuario || 'PERSONAL DE ALMACÉN',
                    quien_recibio: rowObj.concepto || 'RECEPTOR EN SUCURSAL',
                    unidad_transporte: 'ENTREGA EN SUCURSAL / BODEGA',
                    observaciones: rowObj.obs || rowObj.concepto || '',
                    resguardos: []
                },
                signature_info: {
                    has_signature: true,
                    firmante_nombre: rowObj.usuario || 'FIRMA DE CONFORMIDAD',
                    firmante_rol: 'FIRMA VIRTUAL DE CONFORMIDAD Y RESGUARDO',
                    firma_medio: 'FIRMA VIRTUAL DIGITALIZADA',
                    firma_fecha: rowObj.fecha || '',
                    firma_data_url: '',
                    contract_folio: rowObj.folio || 'DOC'
                },
                items: [{
                    partida: 1,
                    sku: rowObj.sku,
                    description: rowObj.productName,
                    unit: rowObj.unit || 'PZA',
                    quantity: (parseFloat(rowObj.entrada) || 0) > 0 ? parseFloat(rowObj.entrada) : parseFloat(rowObj.salida),
                    returned_quantity: 0,
                    unit_price: parseFloat(rowObj.costoUnit) || 0,
                    subtotal: Math.abs(parseFloat(rowObj.totalMov) || 0),
                    is_highlighted: true
                }]
            };
            _kdxActiveDocData = fallbackDoc;
            renderKardexDocumentView(fallbackDoc);
        }
    }

    function renderKardexDocumentView(d) {
        var bodyEl = document.getElementById('pc-kdoc-body');
        var titleEl = document.getElementById('pc-kdoc-title');
        var folioBadge = document.getElementById('pc-kdoc-folio-badge');
        var statusBadge = document.getElementById('pc-kdoc-status-badge');
        var subEl = document.getElementById('pc-kdoc-subtitle');
        if (!bodyEl || !d) return;

        if (titleEl) titleEl.textContent = d.doc_type_label || 'DOCUMENTO FINAL GUARDADO';
        if (folioBadge) folioBadge.textContent = d.folio || 'S/F';
        if (statusBadge) {
            statusBadge.textContent = d.status || 'GUARDADO';
            var isPend = String(d.status || '').indexOf('PEND') !== -1 || (d.credit_info && d.credit_info.is_credit && d.credit_info.current_balance > 0);
            statusBadge.style.background = isPend ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)';
            statusBadge.style.color = isPend ? '#fbbf24' : '#10b981';
        }
        if (subEl) {
            subEl.textContent = 'Fecha de emisión: ' + (d.fecha_emision || '—') + ' · Sucursal: ' + (d.sucursal_origen || 'MATRIZ') + ' · Atendió / Autorizó: ' + (d.vendedor || 'ADMIN');
        }

        var cli = d.client || {};
        var pay = d.payment || {};
        var cred = d.credit_info || {};
        var deliv = d.delivery_info || {};
        var sig = d.signature_info || {};
        var items = Array.isArray(d.items) ? d.items : [];

        // Bloque de Venta a Crédito (si aplica o siempre visible con su condición)
        var creditHtml = '';
        if (cred.is_credit || pay.is_credit) {
            var abonosRows = (Array.isArray(cred.abonos) && cred.abonos.length > 0)
                ? cred.abonos.map(function (ab) {
                    return '<tr>' +
                        '<td>' + escapeHtml(ab.fecha) + '</td>' +
                        '<td><span style="font-weight:800;color:var(--brand-400);">' + escapeHtml(ab.metodo) + '</span> (' + escapeHtml(ab.origen) + ')</td>' +
                        '<td class="pc-mono">' + escapeHtml(ab.referencia) + '</td>' +
                        '<td style="text-align:right;font-weight:800;color:#10b981;">' + fmtMoney(ab.monto) + '</td>' +
                        '<td style="text-align:right;font-weight:800;">' + fmtMoney(ab.saldo_despues) + '</td>' +
                        '<td>' + escapeHtml(ab.registrado_por) + '</td>' +
                    '</tr>';
                }).join('')
                : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:8px;">Sin abonos posteriores registrados</td></tr>';

            creditHtml =
                '<div style="background:rgba(245,158,11,0.08);border:1.5px solid rgba(245,158,11,0.35);border-radius:12px;padding:12px 14px;">' +
                    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">' +
                        '<div style="font-size:12px;font-weight:900;color:#fbbf24;text-transform:uppercase;letter-spacing:.5px;">' +
                            '<i class="fa-solid fa-credit-card" style="margin-right:6px;"></i> DESGLOSE DE OPERACIÓN A CRÉDITO Y CARTERA' +
                        '</div>' +
                        '<span style="padding:2px 10px;border-radius:999px;background:rgba(245,158,11,0.2);color:#fbbf24;font-size:11px;font-weight:900;">' +
                            'ESTATUS CRÉDITO: ' + escapeHtml(cred.status || 'PENDIENTE') + ' · PLAZO: ' + escapeHtml(cred.due_date || (cred.dias_credito + ' DÍAS')) +
                        '</span>' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px;">' +
                        '<div style="background:var(--bg-card);padding:8px 10px;border-radius:8px;border:1px solid var(--border);">' +
                            '<div style="font-size:10px;color:var(--text-secondary);font-weight:700;">MONTO ORIGINAL CRÉDITO</div>' +
                            '<div style="font-size:15px;font-weight:900;font-family:monospace;">' + fmtMoney(cred.original_amount) + '</div>' +
                        '</div>' +
                        '<div style="background:var(--bg-card);padding:8px 10px;border-radius:8px;border:1px solid var(--border);">' +
                            '<div style="font-size:10px;color:var(--text-secondary);font-weight:700;">ANTICIPO / ENGANCHE</div>' +
                            '<div style="font-size:15px;font-weight:900;color:#10b981;font-family:monospace;">' + fmtMoney(cred.anticipo) + '</div>' +
                        '</div>' +
                        '<div style="background:var(--bg-card);padding:8px 10px;border-radius:8px;border:1px solid var(--border);">' +
                            '<div style="font-size:10px;color:var(--text-secondary);font-weight:700;">SALDO PENDIENTE DOC.</div>' +
                            '<div style="font-size:15px;font-weight:900;color:#f87171;font-family:monospace;">' + fmtMoney(cred.current_balance) + '</div>' +
                        '</div>' +
                        '<div style="background:var(--bg-card);padding:8px 10px;border-radius:8px;border:1px solid var(--border);">' +
                            '<div style="font-size:10px;color:var(--text-secondary);font-weight:700;">LÍMITE CRÉDITO CLIENTE</div>' +
                            '<div style="font-size:15px;font-weight:900;color:var(--brand-400);font-family:monospace;">' + fmtMoney(cred.limite_credito) + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="font-size:10.5px;font-weight:800;color:var(--text-secondary);margin-bottom:4px;text-transform:uppercase;">Historial de Abonos / Pagos Aplicados y Referencias:</div>' +
                    '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-card);">' +
                        '<table class="pc-table" style="width:100%;font-size:11.5px;">' +
                            '<thead><tr><th>FECHA</th><th>MÉTODO / ORIGEN</th><th>REFERENCIA</th><th style="text-align:right;">ABONO</th><th style="text-align:right;">SALDO RESTANTE</th><th>RECIBIÓ</th></tr></thead>' +
                            '<tbody>' + abonosRows + '</tbody>' +
                        '</table>' +
                    '</div>' +
                '</div>';
        }

        // Partidas del documento
        var itemsRowsHtml = items.map(function (it) {
            var hiStyle = it.is_highlighted ? 'background:rgba(59,130,246,0.12);font-weight:800;' : '';
            return '<tr style="' + hiStyle + '">' +
                '<td style="text-align:center;font-family:monospace;">' + escapeHtml(it.partida) + '</td>' +
                '<td class="pc-mono" style="font-weight:800;color:var(--brand-400);">' +
                    escapeHtml(it.sku) +
                    (it.is_highlighted ? ' <span style="font-size:9.5px;padding:1px 5px;border-radius:4px;background:rgba(16,185,129,0.2);color:#10b981;margin-left:4px;">CONSULTADO</span>' : '') +
                '</td>' +
                '<td>' + escapeHtml(it.description) + '</td>' +
                '<td style="text-align:center;">' + escapeHtml(it.unit || 'PZA') + '</td>' +
                '<td style="text-align:right;font-family:monospace;font-weight:800;">' + fmtQty(it.quantity) + '</td>' +
                '<td style="text-align:right;font-family:monospace;">' + fmtMoney(it.unit_price) + '</td>' +
                '<td style="text-align:right;font-family:monospace;font-weight:800;">' + fmtMoney(it.subtotal) + '</td>' +
            '</tr>';
        }).join('');

        // Firma virtual (imagen guardada o SVG vectorial estilizado)
        var sigVisualHtml = sig.firma_data_url
            ? '<img src="' + sig.firma_data_url + '" alt="Firma Virtual" style="max-height:95px;max-width:100%;display:block;margin:0 auto;object-fit:contain;">'
            : _buildStylizedSignatureSvg(sig.firmante_nombre || deliv.quien_recibio || cli.name, sig.firma_fecha || d.fecha_emision);

        bodyEl.innerHTML =
            '<!-- Fila 1: Datos Generales del Documento + Cliente/Receptor -->' +
            '<div style="display:grid;grid-template-columns:1.1fr 1.1fr;gap:12px;">' +
                '<!-- Tarjeta Cliente / Proveedor / Receptor -->' +
                '<div style="background:var(--bg-card-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;">' +
                    '<div style="font-size:11px;font-weight:900;color:var(--brand-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">' +
                        '<i class="fa-solid fa-user-check" style="margin-right:6px;"></i> DATOS DEL CLIENTE / RECEPTOR / ORIGEN' +
                    '</div>' +
                    '<div style="font-size:14.5px;font-weight:900;color:var(--text-primary);margin-bottom:4px;">' + escapeHtml(cli.name || 'PÚBLICO EN GENERAL') + '</div>' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11.5px;color:var(--text-secondary);">' +
                        '<div><b>RFC / ID:</b> <span class="pc-mono">' + escapeHtml(cli.rfc || 'XAXX010101000') + '</span></div>' +
                        '<div><b>Código:</b> <span class="pc-mono">' + escapeHtml(cli.code || '—') + '</span></div>' +
                        '<div><b>Teléfono:</b> ' + escapeHtml(cli.phone || 'S/TEL') + '</div>' +
                        '<div><b>Escala Aplicada:</b> <span style="color:#10b981;font-weight:800;">' + escapeHtml(cli.price_scale || 'PÚBLICO') + '</span></div>' +
                        '<div style="grid-column:1 / -1;"><b>Dirección / Ubicación:</b> ' + escapeHtml(cli.address || 'Mostrador') + '</div>' +
                        (d.project ? '<div style="grid-column:1 / -1;color:#38bdf8;font-weight:800;"><i class="fa-solid fa-hard-hat"></i> Obra: ' + escapeHtml(d.project.nombre_obra) + ' · Contratista: ' + escapeHtml(d.project.contratista) + '</div>' : '') +
                    '</div>' +
                '</div>' +

                '<!-- Tarjeta Condición de Pago, Referencia y Sucursal -->' +
                '<div style="background:var(--bg-card-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;">' +
                    '<div style="font-size:11px;font-weight:900;color:#10b981;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">' +
                        '<i class="fa-solid fa-receipt" style="margin-right:6px;"></i> CONDICIÓN DE PAGO, REFERENCIA Y SUCURSAL' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;font-size:11.5px;color:var(--text-secondary);">' +
                        '<div><b>Método de Pago:</b> <span style="font-weight:900;color:' + (pay.is_credit ? '#fbbf24' : '#10b981') + ';">' + escapeHtml(pay.method || 'EFECTIVO') + '</span></div>' +
                        '<div><b>Referencia Guardada:</b> <span class="pc-mono" style="font-weight:900;color:var(--brand-400);">' + escapeHtml(pay.reference || 'S/REF') + '</span></div>' +
                        '<div><b>Sucursal Origen:</b> ' + escapeHtml(d.sucursal_origen || 'MATRIZ') + '</div>' +
                        '<div><b>Sucursal Entrega:</b> ' + escapeHtml(d.sucursal_entrega || 'MATRIZ') + '</div>' +
                        '<div><b>Atendió / Autorizó:</b> ' + escapeHtml(d.vendedor || 'ADMIN') + '</div>' +
                        '<div><b>Canal de Operación:</b> ' + escapeHtml(d.canal_venta || 'MOSTRADOR') + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            '<!-- Fila 2: Logística de Entrega (Quién Llevó / Quién Recibió / Referencias de Entrega) -->' +
            '<div style="background:rgba(59,130,246,0.07);border:1.5px solid rgba(59,130,246,0.3);border-radius:12px;padding:12px 14px;">' +
                '<div style="font-size:11.5px;font-weight:900;color:var(--brand-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">' +
                    '<i class="fa-solid fa-truck-fast" style="margin-right:6px;"></i> CONTROL DE ENTREGA Y TRASLADO — ¿QUIÉN LLEVÓ Y QUIÉN RECIBIÓ?' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">' +
                    '<div style="background:var(--bg-card);padding:9px 12px;border-radius:8px;border:1px solid var(--border);">' +
                        '<div style="font-size:10px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;">¿QUIÉN LLEVÓ / ENTREGÓ?</div>' +
                        '<div style="font-size:13px;font-weight:900;color:var(--text-primary);margin-top:2px;">' + escapeHtml(deliv.quien_llevo || 'DESPACHO MOSTRADOR') + '</div>' +
                    '</div>' +
                    '<div style="background:var(--bg-card);padding:9px 12px;border-radius:8px;border:1px solid var(--border);">' +
                        '<div style="font-size:10px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;"> ¿QUIÉN RECIBIÓ LA MERCANCÍA?</div>' +
                        '<div style="font-size:13px;font-weight:900;color:#10b981;margin-top:2px;">' + escapeHtml(deliv.quien_recibio || cli.name || 'CLIENTE EN MOSTRADOR') + '</div>' +
                    '</div>' +
                    '<div style="background:var(--bg-card);padding:9px 12px;border-radius:8px;border:1px solid var(--border);">' +
                        '<div style="font-size:10px;font-weight:800;color:var(--text-secondary);text-transform:uppercase;"> UNIDAD / MODALIDAD DE ENTREGA</div>' +
                        '<div style="font-size:12.5px;font-weight:800;color:var(--brand-400);margin-top:2px;">' + escapeHtml(deliv.unidad_transporte || 'ENTREGA INMEDIATA') + '</div>' +
                    '</div>' +
                '</div>' +
                '<div style="margin-top:8px;font-size:11.5px;color:var(--text-secondary);">' +
                    '<b>Observaciones / Referencia del Documento:</b> ' + escapeHtml(deliv.observaciones || 'Sin observaciones adicionales.') +
                '</div>' +
            '</div>' +

            creditHtml +

            '<!-- Fila 3: Tabla de Partidas del Documento Guardado -->' +
            '<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg-card);">' +
                '<div style="padding:8px 14px;background:var(--bg-card-2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">' +
                    '<span style="font-size:11px;font-weight:900;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;">' +
                        '<i class="fa-solid fa-boxes-stacked" style="color:var(--brand-400);margin-right:6px;"></i> PARTIDAS REGISTRADAS EN EL DOCUMENTO (' + items.length + ')' +
                    '</span>' +
                    '<span style="font-size:11px;font-weight:800;color:var(--brand-400);">Folio: ' + escapeHtml(d.folio) + '</span>' +
                '</div>' +
                '<table class="pc-table" style="width:100%;">' +
                    '<thead><tr><th style="width:45px;text-align:center;">#</th><th>SKU</th><th>DESCRIPCIÓN DEL ARTÍCULO</th><th style="text-align:center;">UNIDAD</th><th style="text-align:right;">CANTIDAD</th><th style="text-align:right;">PRECIO / COSTO UNIT.</th><th style="text-align:right;">IMPORTE</th></tr></thead>' +
                    '<tbody>' + itemsRowsHtml + '</tbody>' +
                '</table>' +
                '<div style="padding:10px 16px;background:var(--bg-card-2);border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:22px;flex-wrap:wrap;font-size:12.5px;">' +
                    '<div>Subtotal: <b style="font-family:monospace;">' + fmtMoney(pay.subtotal) + '</b></div>' +
                    (pay.discount > 0 ? '<div>Descuento: <b style="font-family:monospace;color:#f59e0b;">-' + fmtMoney(pay.discount) + '</b></div>' : '') +
                    (pay.tax > 0 ? '<div>IVA (16%): <b style="font-family:monospace;">' + fmtMoney(pay.tax) + '</b></div>' : '') +
                    '<div style="font-size:14px;">TOTAL DOCUMENTO: <b style="font-family:monospace;color:#10b981;font-size:15.5px;">' + fmtMoney(pay.total) + '</b></div>' +
                '</div>' +
            '</div>' +

            '<!-- Fila 4: Firma Virtual Digitalizada y Sello de Conformidad -->' +
            '<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:12px;align-items:stretch;">' +
                '<div style="background:var(--bg-card-2);border:1.5px dashed rgba(59,130,246,0.45);border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;justify-content:space-between;">' +
                    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
                        '<span style="font-size:11px;font-weight:900;color:var(--brand-400);text-transform:uppercase;">' +
                            '<i class="fa-solid fa-signature" style="margin-right:5px;"></i> FIRMA VIRTUAL Y SELLO DE CONFORMIDAD' +
                        '</span>' +
                        '<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(16,185,129,0.16);color:#10b981;font-weight:800;">' +
                            '<i class="fa-solid fa-shield-check"></i> ' + escapeHtml(sig.firma_medio || 'VERIFICADA') +
                        '</span>' +
                    '</div>' +
                    '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;min-height:98px;display:flex;align-items:center;justify-content:center;">' +
                        sigVisualHtml +
                    '</div>' +
                    '<div style="text-align:center;margin-top:6px;">' +
                        '<div style="font-size:12px;font-weight:900;color:var(--text-primary);">' + escapeHtml(sig.firmante_nombre || deliv.quien_recibio || cli.name) + '</div>' +
                        '<div style="font-size:10px;color:var(--text-secondary);font-weight:700;">' + escapeHtml(sig.firmante_rol || 'FIRMA DE RECIBIDO') + ' · Folio: ' + escapeHtml(sig.contract_folio || d.folio) + '</div>' +
                    '</div>' +
                '</div>' +

                '<div style="background:var(--bg-card-2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;font-size:11.5px;color:var(--text-secondary);">' +
                    '<div>' +
                        '<div style="font-size:11px;font-weight:900;color:var(--text-primary);text-transform:uppercase;margin-bottom:6px;">' +
                            '<i class="fa-solid fa-scale-balanced" style="color:var(--brand-400);margin-right:5px;"></i> CONSTANCIA DOCUMENTAL DE KARDEX' +
                        '</div>' +
                        '<p style="margin:0 0 8px 0;line-height:1.45;">' +
                            'Este documento respalda físicamente y contablemente el movimiento en el Kardex de inventario bajo el folio <b>' + escapeHtml(d.folio) + '</b>.' +
                        '</p>' +
                        '<div style="padding:8px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border);font-size:11px;">' +
                            '<div><b>Fecha/Hora Firma:</b> ' + escapeHtml(sig.firma_fecha || d.fecha_emision) + '</div>' +
                            '<div><b>Entregado por:</b> ' + escapeHtml(deliv.quien_llevo) + '</div>' +
                            '<div><b>Recibido por:</b> ' + escapeHtml(deliv.quien_recibio) + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            '<!-- Panel Opcional para Editar Quién Llevó / Referencia / Firmar en Pantalla -->' +
            '<div id="pc-kdoc-edit-panel" style="display:none;background:var(--bg-card-2);border:1.5px solid var(--brand-400);border-radius:12px;padding:14px;">' +
                '<div style="font-size:12px;font-weight:900;color:var(--brand-400);text-transform:uppercase;margin-bottom:10px;">' +
                    '<i class="fa-solid fa-pen-to-square"></i> ACTUALIZAR DATOS DE ENTREGA, REFERENCIA Y FIRMA VIRTUAL EN PANTALLA' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">' +
                    '<div>' +
                        '<label style="font-size:10.5px;font-weight:800;color:var(--text-secondary);">¿QUIÉN LLEVÓ / DESPACHÓ?</label>' +
                        '<input type="text" id="pc-kdoc-inp-llevo" class="form-control" style="height:34px;font-size:12px;" value="' + escapeHtml(deliv.quien_llevo || '') + '">' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:10.5px;font-weight:800;color:var(--text-secondary);">¿QUIÉN RECIBIÓ / FIRMÓ?</label>' +
                        '<input type="text" id="pc-kdoc-inp-recibio" class="form-control" style="height:34px;font-size:12px;" value="' + escapeHtml(deliv.quien_recibio || '') + '">' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:10.5px;font-weight:800;color:var(--text-secondary);">REFERENCIA (PAGO / ENTREGA)</label>' +
                        '<input type="text" id="pc-kdoc-inp-ref" class="form-control" style="height:34px;font-size:12px;" value="' + escapeHtml(pay.reference || '') + '">' +
                    '</div>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">' +
                    '<div>' +
                        '<label style="font-size:10.5px;font-weight:800;color:var(--text-secondary);">UNIDAD / MEDIO DE ENTREGA</label>' +
                        '<input type="text" id="pc-kdoc-inp-unidad" class="form-control" style="height:34px;font-size:12px;" value="' + escapeHtml(deliv.unidad_transporte || '') + '">' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:10.5px;font-weight:800;color:var(--text-secondary);">OBSERVACIONES DE ENTREGA</label>' +
                        '<input type="text" id="pc-kdoc-inp-obs" class="form-control" style="height:34px;font-size:12px;" value="' + escapeHtml(deliv.observaciones || '') + '">' +
                    '</div>' +
                '</div>' +
                '<div style="margin-bottom:10px;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                        '<label style="font-size:10.5px;font-weight:800;color:var(--text-secondary);">TRAZAR FIRMA VIRTUAL CON MOUSE O PANTALLA TÁCTIL:</label>' +
                        '<button type="button" class="btn btn-secondary btn-sm" style="height:26px;font-size:11px;padding:0 10px;" data-click="productsKardexDocClearCanvas">Limpiar Trazo</button>' +
                    '</div>' +
                    '<canvas id="pc-kdoc-sig-canvas" width="520" height="110" style="width:100%;height:110px;background:#ffffff;border:1.5px solid #94a3b8;border-radius:8px;cursor:crosshair;touch-action:none;"></canvas>' +
                '</div>' +
                '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
                    '<button type="button" class="btn btn-secondary btn-sm" data-click="productsKardexDocToggleEdit">Cancelar</button>' +
                    '<button type="button" class="btn btn-primary btn-sm" data-click="productsKardexDocSaveMeta"><i class="fa-solid fa-floppy-disk"></i> Guardar en Documento</button>' +
                '</div>' +
            '</div>';
    }

    function _initKdocSignatureCanvas() {
        var canvas = document.getElementById('pc-kdoc-sig-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        _kdxSigHasDrawn = false;
        ctx.strokeStyle = '#1e3a8a';
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        var drawing = false;
        function getPos(ev) {
            var rect = canvas.getBoundingClientRect();
            var clientX = ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX;
            var clientY = ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY;
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height)
            };
        }
        canvas.onmousedown = function (ev) {
            drawing = true;
            _kdxSigHasDrawn = true;
            var p = getPos(ev);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
        };
        canvas.onmousemove = function (ev) {
            if (!drawing) return;
            var p = getPos(ev);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        };
        canvas.onmouseup = function () { drawing = false; };
        canvas.onmouseleave = function () { drawing = false; };
        canvas.ontouchstart = function (ev) {
            ev.preventDefault();
            drawing = true;
            _kdxSigHasDrawn = true;
            var p = getPos(ev);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
        };
        canvas.ontouchmove = function (ev) {
            ev.preventDefault();
            if (!drawing) return;
            var p = getPos(ev);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        };
        canvas.ontouchend = function () { drawing = false; };
    }

    function printKardexSingleDocument() {
        var d = _kdxActiveDocData;
        if (!d) return;
        var cli = d.client || {};
        var pay = d.payment || {};
        var cred = d.credit_info || {};
        var deliv = d.delivery_info || {};
        var sig = d.signature_info || {};
        var items = Array.isArray(d.items) ? d.items : [];

        var w = window.open('', '_blank', 'width=940,height=740');
        if (!w) {
            showCalebsysAlertModal('Impresión Bloqueada', 'Permita las ventanas emergentes en el navegador para imprimir el documento.', '');
            return;
        }
        var itemsHtml = items.map(function (it) {
            return '<tr>' +
                '<td style="text-align:center;">' + escapeHtml(it.partida) + '</td>' +
                '<td><b>' + escapeHtml(it.sku) + '</b></td>' +
                '<td>' + escapeHtml(it.description) + '</td>' +
                '<td style="text-align:center;">' + escapeHtml(it.unit || 'PZA') + '</td>' +
                '<td style="text-align:right;">' + fmtQty(it.quantity) + '</td>' +
                '<td style="text-align:right;">' + fmtMoney(it.unit_price) + '</td>' +
                '<td style="text-align:right;font-weight:bold;">' + fmtMoney(it.subtotal) + '</td>' +
            '</tr>';
        }).join('');

        var sigHtml = sig.firma_data_url
            ? '<img src="' + sig.firma_data_url + '" style="max-height:80px;">'
            : _buildStylizedSignatureSvg(sig.firmante_nombre || deliv.quien_recibio || cli.name, sig.firma_fecha || d.fecha_emision);

        w.document.write(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escapeHtml(d.folio) + ' - CALEBSYS</title>' +
            '<style>' +
                'body{font-family:Arial,sans-serif;margin:20px;color:#0f172a;font-size:12px;}' +
                '.hdr{display:flex;justify-content:space-between;border-bottom:2px solid #1e3a8a;padding-bottom:10px;margin-bottom:12px;}' +
                '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}' +
                '.box{border:1px solid #cbd5e1;border-radius:6px;padding:10px;background:#f8fafc;}' +
                'table{width:100%;border-collapse:collapse;margin-bottom:12px;}' +
                'th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:11.5px;}' +
                'th{background:#e2e8f0;text-transform:uppercase;font-size:10px;}' +
            '</style></head><body>' +
            '<div class="hdr">' +
                '<div><h2 style="margin:0;color:#1e3a8a;">' + escapeHtml(d.doc_type_label) + '</h2><div>Sucursal Origen: <b>' + escapeHtml(d.sucursal_origen) + '</b> · Entrega: <b>' + escapeHtml(d.sucursal_entrega) + '</b></div></div>' +
                '<div style="text-align:right;"><div style="font-size:16px;font-weight:bold;">FOLIO: ' + escapeHtml(d.folio) + '</div><div>Fecha: ' + escapeHtml(d.fecha_emision) + '</div><div>Estado: <b>' + escapeHtml(d.status) + '</b></div></div>' +
            '</div>' +
            '<div class="grid">' +
                '<div class="box"><b>CLIENTE / RECEPTOR:</b><br>' + escapeHtml(cli.name) + '<br>RFC: ' + escapeHtml(cli.rfc) + ' · Tel: ' + escapeHtml(cli.phone) + '<br>Dirección: ' + escapeHtml(cli.address) + '</div>' +
                '<div class="box"><b>CONDICIÓN DE PAGO Y ENTREGA:</b><br>Método: <b>' + escapeHtml(pay.method) + '</b> · Ref: <b>' + escapeHtml(pay.reference) + '</b><br>Quién Llevó: <b>' + escapeHtml(deliv.quien_llevo) + '</b><br>Quién Recibió: <b>' + escapeHtml(deliv.quien_recibio) + '</b></div>' +
            '</div>' +
            (cred.is_credit ? '<div class="box" style="margin-bottom:12px;background:#fffbeb;border-color:#f59e0b;"><b>VENTA A CRÉDITO:</b> Monto Original: ' + fmtMoney(cred.original_amount) + ' | Anticipo: ' + fmtMoney(cred.anticipo) + ' | <b>Saldo Pendiente: ' + fmtMoney(cred.current_balance) + '</b> | Vencimiento: ' + escapeHtml(cred.due_date) + '</div>' : '') +
            '<table><thead><tr><th>#</th><th>SKU</th><th>Descripción</th><th>Unidad</th><th>Cantidad</th><th>Precio Unit.</th><th>Importe</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>' +
            '<div style="text-align:right;font-size:14px;font-weight:bold;margin-bottom:16px;">TOTAL DOCUMENTO: ' + fmtMoney(pay.total) + '</div>' +
            '<div style="border:1px solid #94a3b8;border-radius:8px;padding:12px;text-align:center;max-width:440px;margin:0 auto;">' +
                sigHtml +
                '<div style="border-top:1px solid #64748b;margin-top:6px;padding-top:4px;font-weight:bold;">' + escapeHtml(sig.firmante_nombre || deliv.quien_recibio) + '</div>' +
                '<div style="font-size:10px;color:#475569;">' + escapeHtml(sig.firmante_rol) + '</div>' +
            '</div>' +
            '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
            '</body></html>'
        );
        w.document.close();
    }

    function _getKardexReportSummaryMeta() {
        var selectedProducts = getKardexSelectedProductsList();
        var prodSel = document.getElementById('pc-kdx-product');
        var prodVal = prodSel ? prodSel.value : 'SELECTED_ALL';
        var prodLabel = selectedProducts.map(function (p) { return p.sku + ' - ' + (p.name || p.description || ''); }).join(', ');
        if (prodVal && prodVal !== 'SELECTED_ALL') {
            var found = selectedProducts.find(function (p) { return String(p.sku).toUpperCase() === String(prodVal).toUpperCase(); });
            if (found) prodLabel = found.sku + ' - ' + (found.name || found.description || '');
        }
        var dFrom = (document.getElementById('pc-kdx-date-from') || {}).value || '';
        var dTo = (document.getElementById('pc-kdx-date-to') || {}).value || '';
        var rangeLabel = (dFrom || dTo) ? ('De ' + (dFrom || 'Inicio') + ' hasta ' + (dTo || 'Hoy')) : 'Todo el historial';
        return {
            prodLabel: prodLabel || 'Productos seleccionados',
            rangeLabel: rangeLabel
        };
    }

    function exportKardexExcel() {
        var rows = getKardexTargetRowsForReport();
        var metaInfo = _getKardexReportSummaryMeta();
        var totalIn = 0, totalOut = 0, netVal = 0;
        rows.forEach(function (r) {
            totalIn += parseFloat(r.entrada) || 0;
            totalOut += parseFloat(r.salida) || 0;
            netVal += parseFloat(r.totalMov) || 0;
        });

        var tableHtml =
            '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
            '<head><meta charset="UTF-8"></head><body>' +
            '<table border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;">' +
            '<tr><th colspan="11" style="background:#1e3a8a;color:#ffffff;font-size:14px;padding:8px;text-align:left;">REPORTE DE KARDEX DE INVENTARIO - CALEBSYS ERP</th></tr>' +
            '<tr><td colspan="6"><b>Producto(s):</b> ' + escapeHtml(metaInfo.prodLabel) + '</td><td colspan="5"><b>Rango de Fechas:</b> ' + escapeHtml(metaInfo.rangeLabel) + '</td></tr>' +
            '<tr><td colspan="3"><b>Movimientos:</b> ' + rows.length + '</td><td colspan="3"><b>Total Entradas (+):</b> +' + fmtQty(totalIn) + '</td><td colspan="3"><b>Total Salidas (-):</b> -' + fmtQty(totalOut) + '</td><td colspan="2"><b>Importe Neto:</b> ' + fmtMoney(netVal) + '</td></tr>' +
            '<tr style="background:#e2e8f0;font-weight:bold;">' +
                '<th>FECHA / HORA</th><th>FOLIO</th><th>SKU</th><th>PRODUCTO</th><th>SUCURSAL / BODEGA</th><th>TIPO DOCUMENTO</th><th>CONCEPTO / REFERENCIA</th><th>ENTRADA (+)</th><th>SALIDA (-)</th><th>EXISTENCIA</th><th>COSTO / PRECIO</th>' +
            '</tr>';

        if (rows.length === 0) {
            tableHtml += '<tr><td colspan="11" style="text-align:center;padding:12px;">Sin movimientos registrados en el periodo seleccionado.</td></tr>';
        } else {
            rows.forEach(function (r) {
                tableHtml +=
                    '<tr>' +
                        '<td>' + escapeHtml(r.fecha || r.isoDate) + '</td>' +
                        '<td>' + escapeHtml(r.folio) + '</td>' +
                        '<td>' + escapeHtml(r.sku) + '</td>' +
                        '<td>' + escapeHtml(r.productName) + '</td>' +
                        '<td>' + escapeHtml(r.almacenNombre || r.almacenKey) + '</td>' +
                        '<td>' + escapeHtml(r.docTipoLabel || r.tipo) + '</td>' +
                        '<td>' + escapeHtml(r.concepto) + '</td>' +
                        '<td style="text-align:right;">' + (parseFloat(r.entrada) || 0).toFixed(2) + '</td>' +
                        '<td style="text-align:right;">' + (parseFloat(r.salida) || 0).toFixed(2) + '</td>' +
                        '<td style="text-align:right;">' + (parseFloat(r.saldo) || 0).toFixed(2) + '</td>' +
                        '<td style="text-align:right;">' + fmtMoney(r.costoUnit) + '</td>' +
                    '</tr>';
            });
        }
        tableHtml += '</table></body></html>';

        var blob = new Blob(['\uFEFF' + tableHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kardex_calebsys_' + new Date().toISOString().slice(0, 10) + '.xls';
        a.click();
        if (typeof global.showToast === 'function') {
            global.showToast('Reporte de Kardex descargado en archivo Excel (.xls).', 'success');
        }
    }

    function printKardexReport() {
        var rows = getKardexTargetRowsForReport();
        var metaInfo = _getKardexReportSummaryMeta();
        var totalIn = 0, totalOut = 0, netVal = 0;
        rows.forEach(function (r) {
            totalIn += parseFloat(r.entrada) || 0;
            totalOut += parseFloat(r.salida) || 0;
            netVal += parseFloat(r.totalMov) || 0;
        });

        var w = window.open('', '_blank', 'width=1020,height=740');
        if (!w) {
            showCalebsysAlertModal('Impresión Bloqueada', 'Permita las ventanas emergentes en su navegador para imprimir el reporte.', '');
            return;
        }
        var rowsHtml = rows.length === 0
            ? '<tr><td colspan="10" style="text-align:center;padding:18px;color:#64748b;">No hay movimientos registrados para este criterio.</td></tr>'
            : rows.map(function (r) {
                var ent = parseFloat(r.entrada) || 0;
                var sal = parseFloat(r.salida) || 0;
                return '<tr>' +
                    '<td>' + escapeHtml(r.fecha || r.isoDate) + '</td>' +
                    '<td><b>' + escapeHtml(r.folio) + '</b></td>' +
                    '<td><b>' + escapeHtml(r.sku) + '</b> - ' + escapeHtml(r.productName) + '</td>' +
                    '<td>' + escapeHtml(r.almacenNombre || r.almacenKey) + '</td>' +
                    '<td>' + escapeHtml(r.docTipoLabel || r.tipo) + '</td>' +
                    '<td>' + escapeHtml(r.concepto) + '</td>' +
                    '<td style="text-align:right;color:#047857;font-weight:700;">' + (ent > 0 ? ('+' + fmtQty(ent)) : '-') + '</td>' +
                    '<td style="text-align:right;color:#b91c1c;font-weight:700;">' + (sal > 0 ? ('-' + fmtQty(sal)) : '-') + '</td>' +
                    '<td style="text-align:right;font-weight:700;">' + fmtQty(r.saldo) + '</td>' +
                    '<td style="text-align:right;">' + fmtMoney(r.costoUnit) + '</td>' +
                '</tr>';
            }).join('');

        w.document.write(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reporte de Kardex - CALEBSYS</title>' +
            '<style>' +
                'body{font-family:Arial,sans-serif;margin:20px;color:#0f172a;font-size:12px;}' +
                'h1{margin:0 0 4px 0;font-size:18px;color:#1e3a8a;}' +
                '.meta{margin-bottom:12px;padding:10px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;}' +
                '.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;}' +
                '.kpi{padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;}' +
                '.kpi b{display:block;font-size:15px;margin-top:2px;}' +
                'table{width:100%;border-collapse:collapse;}' +
                'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;font-size:11px;}' +
                'th{background:#f1f5f9;text-transform:uppercase;font-size:10px;}' +
            '</style></head><body>' +
            '<h1>REPORTE DE KARDEX DE INVENTARIO [F12]</h1>' +
            '<div class="meta">' +
                '<div><b>Producto(s):</b> ' + escapeHtml(metaInfo.prodLabel) + '</div>' +
                '<div><b>Rango de Fechas:</b> ' + escapeHtml(metaInfo.rangeLabel) + '</div>' +
                '<div><b>Impreso:</b> ' + new Date().toLocaleString('es-MX') + '</div>' +
            '</div>' +
            '<div class="kpis">' +
                '<div class="kpi">Movimientos Listados<b>' + rows.length + '</b></div>' +
                '<div class="kpi">Total Entradas (+)<b>+' + fmtQty(totalIn) + '</b></div>' +
                '<div class="kpi">Total Salidas (-)<b>-' + fmtQty(totalOut) + '</b></div>' +
                '<div class="kpi">Importe Neto<b>' + fmtMoney(netVal) + '</b></div>' +
            '</div>' +
            '<table><thead><tr>' +
                '<th>Fecha / Hora</th><th>Folio</th><th>Producto</th><th>Sucursal</th><th>Tipo Doc.</th><th>Concepto</th><th style="text-align:right;">Entrada</th><th style="text-align:right;">Salida</th><th style="text-align:right;">Existencia</th><th style="text-align:right;">Costo/Precio</th>' +
            '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
            '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
            '</body></html>'
        );
        w.document.close();
    }

    function _buildKardexTextMessage(extraNote) {
        var rows = getKardexTargetRowsForReport();
        var metaInfo = _getKardexReportSummaryMeta();
        var totalIn = 0, totalOut = 0, netVal = 0;
        rows.forEach(function (r) {
            totalIn += parseFloat(r.entrada) || 0;
            totalOut += parseFloat(r.salida) || 0;
            netVal += parseFloat(r.totalMov) || 0;
        });
        var lines = [
            '*REPORTE DE KARDEX - CALEBSYS ERP*',
            'Producto(s): ' + metaInfo.prodLabel,
            'Periodo: ' + metaInfo.rangeLabel,
            'Movimientos: ' + rows.length + ' | Entradas: +' + fmtQty(totalIn) + ' | Salidas: -' + fmtQty(totalOut) + ' | Neto: ' + fmtMoney(netVal)
        ];
        if (extraNote) {
            lines.push(' Nota: ' + extraNote);
        }
        lines.push('--------------------------------');
        rows.slice(0, 18).forEach(function (r) {
            var movStr = (parseFloat(r.entrada) > 0) ? ('+' + fmtQty(r.entrada)) : ('-' + fmtQty(r.salida));
            lines.push('- [' + (r.fecha || r.isoDate) + '] ' + r.folio + ' | ' + r.sku + ' | ' + movStr + ' (Exist: ' + fmtQty(r.saldo) + ')');
        });
        if (rows.length > 18) {
            lines.push('... y ' + (rows.length - 18) + ' movimientos adicionales.');
        }
        return lines.join('\n');
    }

    // ========================================================================
    // MODAL CALEBSYS CENTRADO PARA ENVIAR POR WHATSAPP O CORREO ELECTRÓNICO
    // ========================================================================
    function openKardexSendModal(defaultChannel) {
        _kdxSendChannel = (defaultChannel === 'EMAIL') ? 'EMAIL' : 'WHATSAPP';
        var noteEl = document.getElementById('pc-kdx-send-note-input');
        if (noteEl) noteEl.value = '';
        selectKardexSendChannel(_kdxSendChannel);
        var prevEl = document.getElementById('pc-kdx-send-preview');
        if (prevEl) prevEl.textContent = _buildKardexTextMessage('');
        _openModalById('modal-pc-kdx-send');
        setTimeout(function () {
            var inp = document.getElementById('pc-kdx-send-dest-input');
            if (inp) inp.focus();
        }, 50);
    }

    function selectKardexSendChannel(channel) {
        _kdxSendChannel = (channel === 'EMAIL') ? 'EMAIL' : 'WHATSAPP';
        var btnWa = document.getElementById('pc-kdx-channel-wa');
        var btnMail = document.getElementById('pc-kdx-channel-mail');
        var lbl = document.getElementById('pc-kdx-send-dest-label');
        var inp = document.getElementById('pc-kdx-send-dest-input');

        if (_kdxSendChannel === 'WHATSAPP') {
            if (btnWa) {
                btnWa.style.border = '2px solid #22c55e';
                btnWa.style.background = 'rgba(34,197,94,0.14)';
                btnWa.style.color = 'var(--text-primary)';
            }
            if (btnMail) {
                btnMail.style.border = '1.5px solid var(--border)';
                btnMail.style.background = 'var(--bg-card-2)';
                btnMail.style.color = 'var(--text-secondary)';
            }
            if (lbl) lbl.textContent = '2. Número de WhatsApp del Destinatario (10 dígitos)';
            if (inp) {
                inp.value = '';
                inp.placeholder = 'Ej. 3312345678 (o deje vacío para elegir contacto en WhatsApp)';
            }
        } else {
            if (btnMail) {
                btnMail.style.border = '2px solid #38bdf8';
                btnMail.style.background = 'rgba(56,189,248,0.14)';
                btnMail.style.color = 'var(--text-primary)';
            }
            if (btnWa) {
                btnWa.style.border = '1.5px solid var(--border)';
                btnWa.style.background = 'var(--bg-card-2)';
                btnWa.style.color = 'var(--text-secondary)';
            }
            if (lbl) lbl.textContent = '2. Correo Electrónico del Destinatario';
            if (inp) {
                inp.value = '';
                inp.placeholder = 'Ej. compras@empresa.com, gerencia@cliente.com';
            }
        }
    }

    function confirmKardexSend() {
        var dest = String((document.getElementById('pc-kdx-send-dest-input') || {}).value || '').trim();
        var note = String((document.getElementById('pc-kdx-send-note-input') || {}).value || '').trim();
        var msg = _buildKardexTextMessage(note);

        _closeModalById('modal-pc-kdx-send');

        if (_kdxSendChannel === 'WHATSAPP') {
            var cleanPhone = dest.replace(/\D+/g, '');
            if (cleanPhone.length === 10) cleanPhone = '52' + cleanPhone;
            var waUrl = cleanPhone
                ? ('https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(msg))
                : ('https://wa.me/?text=' + encodeURIComponent(msg));
            global.open(waUrl, '_blank', 'noopener');
            toast('Reporte de Kardex enviado a WhatsApp.', 'success');
        } else {
            var subject = 'Reporte de Kardex de Inventario - CALEBSYS ERP';
            var mailtoUrl = 'mailto:' + encodeURIComponent(dest) +
                '?subject=' + encodeURIComponent(subject) +
                '&body=' + encodeURIComponent(msg);
            global.location.href = mailtoUrl;
            toast('Abriendo cliente de correo con el reporte de Kardex.', 'success');
        }
    }

    // ========================================================================
    // ATAJOS DE TECLADO EN #productos Y EN #modal-pc-kardex
    // ========================================================================
    function isAnyModalOpen() {
        var modals = ['modal-pc-alert', 'modal-pc-kdx-send', 'modal-pc-kdx-doc', 'modal-pc-existencias', 'modal-pc-kardex', 'modal-pc-quick-filter', 'modal-detalle-producto', 'modal-paquetes-f10', 'modal-producto-express-f1'];
        return modals.some(_isModalOpenById);
    }

    function bindKeyboard() {
        if (_keyBound) return;
        _keyBound = true;

        document.addEventListener('keydown', function (e) {
            var root = document.getElementById('productos-root');
            if (!root || root.offsetParent === null) return;

            var tag = (e.target && e.target.tagName) || '';
            var isTargetVisible = Boolean(e.target && e.target.offsetParent !== null);
            var inInput = isTargetVisible && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable));
            var isCheckboxInput = tag === 'INPUT' && e.target && e.target.type === 'checkbox';
            if (isCheckboxInput) inInput = false;

            // 1. Si el modal de Alerta CALEBSYS está abierto -> cerrar con ENTER, ESPACIO o ESC
            if (_isModalOpenById('modal-pc-alert')) {
                if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    _closeModalById('modal-pc-alert');
                    keepSearchInputFocused(true);
                }
                return;
            }

            // 2. Si el modal de Envío (WhatsApp / Correo) está abierto
            if (_isModalOpenById('modal-pc-kdx-send')) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    _closeModalById('modal-pc-kdx-send');
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmKardexSend();
                    return;
                }
                return;
            }

            // 3. Si el Visor de Documento Guardado de Kardex está abierto -> cerrar con ESC
            if (_isModalOpenById('modal-pc-kdx-doc')) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    _closeModalById('modal-pc-kdx-doc');
                    return;
                }
                return;
            }

            // 4. Si el Modal de KARDEX [F12] está abierto -> Flechas ↑/↓, ESPACIO para marcar y ENTER para ver documento guardado
            if (_isModalOpenById('modal-pc-kardex')) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    _closeModalById('modal-pc-kardex');
                    keepSearchInputFocused(false);
                    return;
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    if (!_kdxFilteredRows.length) return;
                    e.preventDefault();
                    var nextKdxIdx = e.key === 'ArrowDown'
                        ? Math.min(_kdxFilteredRows.length - 1, _kdxActiveIndex + 1)
                        : Math.max(0, _kdxActiveIndex - 1);
                    selectKardexRowByIndex(nextKdxIdx, true);
                    return;
                }
                if ((e.key === ' ' || e.code === 'Space') && !inInput) {
                    e.preventDefault();
                    toggleKardexRowCheckByIndex(_kdxActiveIndex);
                    return;
                }
                if (e.key === 'Enter' && (!inInput || (e.target && e.target.id === 'pc-kdx-search'))) {
                    e.preventDefault();
                    if (_kdxFilteredRows[_kdxActiveIndex]) {
                        openKardexDocumentModal(_kdxFilteredRows[_kdxActiveIndex]);
                    }
                    return;
                }
                return;
            }

            // 5. Si el usuario está en el buscador del modal de filtro rápido (F4/F5/F6) y presiona ENTER
            if (inInput && e.target && e.target.id === 'pc-qf-search' && e.key === 'Enter') {
                e.preventDefault();
                var firstItem = document.querySelector('#pc-qf-list .pc-fmodal-item[data-click-arg]:not([data-click-arg=""])') ||
                                document.querySelector('#pc-qf-list .pc-fmodal-item');
                if (firstItem) {
                    pickQuickFilterValue(firstItem.getAttribute('data-click-arg') || '');
                }
                return;
            }

            // 5.5 Si el modal ⚡ Producto Express [F1] está abierto -> navegación por FLECHAS y ENTER paso a paso hasta Guardar
            if (_isModalOpenById('modal-producto-express-f1')) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    if (typeof global.expF1CloseModal === 'function') {
                        global.expF1CloseModal();
                    } else {
                        _closeModalById('modal-producto-express-f1');
                        keepSearchInputFocused(true);
                    }
                    return;
                }
                if (e.key === 'F1') {
                    e.preventDefault();
                    var expCodF1 = document.getElementById('exp-codigo');
                    if (expCodF1) { expCodF1.focus(); expCodF1.select(); }
                    return;
                }

                var tId = (e.target && e.target.id) || '';
                var btnPieza = document.getElementById('exp-mode-pieza');
                var btnGranel = document.getElementById('exp-mode-granel');
                var codInp = document.getElementById('exp-codigo');
                var btnGen = document.getElementById('exp-btn-gen-codigo');
                var nomInp = document.getElementById('exp-nombre');
                var cosInp = document.getElementById('exp-costo');
                var utiInp = document.getElementById('exp-utilidad');
                var prcInp = document.getElementById('exp-precio-final');
                var chkRaf = document.getElementById('exp-chk-rafaga');
                var btnSave = document.getElementById('exp-btn-guardar');

                var _focusBox = function (el) {
                    if (!el) return;
                    el.focus();
                    if (typeof el.select === 'function' && (el.tagName === 'INPUT') && el.type !== 'checkbox') {
                        try { el.select(); } catch (err) {}
                    }
                };

                // Navegación con Flechas (↑, ↓, ←, →) por cada recuadro
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (tId === 'exp-mode-pieza' || tId === 'exp-mode-granel') {
                        _focusBox(codInp);
                    } else if (tId === 'exp-codigo' || tId === 'exp-btn-gen-codigo') {
                        _focusBox(nomInp);
                    } else if (tId === 'exp-nombre') {
                        _focusBox(cosInp);
                    } else if (tId === 'exp-costo') {
                        _focusBox(utiInp);
                    } else if (tId === 'exp-utilidad') {
                        _focusBox(prcInp);
                    } else if (tId === 'exp-precio-final') {
                        _focusBox(btnSave);
                    } else if (tId === 'exp-chk-rafaga') {
                        _focusBox(btnSave);
                    } else {
                        _focusBox(codInp);
                    }
                    return;
                }

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (tId === 'exp-btn-guardar' || tId === 'exp-chk-rafaga') {
                        _focusBox(prcInp);
                    } else if (tId === 'exp-precio-final') {
                        _focusBox(utiInp);
                    } else if (tId === 'exp-utilidad') {
                        _focusBox(cosInp);
                    } else if (tId === 'exp-costo') {
                        _focusBox(nomInp);
                    } else if (tId === 'exp-nombre') {
                        _focusBox(codInp);
                    } else if (tId === 'exp-codigo' || tId === 'exp-btn-gen-codigo') {
                        var activeModeBtn = (_expF1Mode === 'GRANEL') ? btnGranel : btnPieza;
                        _focusBox(activeModeBtn);
                    } else {
                        _focusBox(codInp);
                    }
                    return;
                }

                if (e.key === 'ArrowRight') {
                    if (tId === 'exp-mode-pieza' || tId === 'exp-mode-granel') {
                        e.preventDefault();
                        global.expF1SelectMode('GRANEL', true);
                        _focusBox(btnGranel);
                        return;
                    }
                    if (tId === 'exp-codigo') {
                        var valLen = String(codInp.value || '').length;
                        var selEnd = (typeof codInp.selectionEnd === 'number') ? codInp.selectionEnd : valLen;
                        if (valLen === 0 || selEnd >= valLen) {
                            e.preventDefault();
                            _focusBox(btnGen);
                            return;
                        }
                    }
                    if (tId === 'exp-btn-gen-codigo') {
                        e.preventDefault();
                        _focusBox(nomInp);
                        return;
                    }
                    if (tId === 'exp-costo') {
                        e.preventDefault();
                        _focusBox(utiInp);
                        return;
                    }
                    if (tId === 'exp-utilidad') {
                        e.preventDefault();
                        _focusBox(prcInp);
                        return;
                    }
                    if (tId === 'exp-precio-final') {
                        e.preventDefault();
                        _focusBox(btnSave);
                        return;
                    }
                    if (tId === 'exp-chk-rafaga') {
                        e.preventDefault();
                        _focusBox(btnSave);
                        return;
                    }
                }

                if (e.key === 'ArrowLeft') {
                    if (tId === 'exp-mode-pieza' || tId === 'exp-mode-granel') {
                        e.preventDefault();
                        global.expF1SelectMode('PIEZA', true);
                        _focusBox(btnPieza);
                        return;
                    }
                    if (tId === 'exp-btn-gen-codigo') {
                        e.preventDefault();
                        _focusBox(codInp);
                        return;
                    }
                    if (tId === 'exp-costo') {
                        e.preventDefault();
                        _focusBox(nomInp);
                        return;
                    }
                    if (tId === 'exp-utilidad') {
                        e.preventDefault();
                        _focusBox(cosInp);
                        return;
                    }
                    if (tId === 'exp-precio-final') {
                        e.preventDefault();
                        _focusBox(utiInp);
                        return;
                    }
                    if (tId === 'exp-btn-guardar') {
                        e.preventDefault();
                        _focusBox(chkRaf);
                        return;
                    }
                    if (tId === 'exp-chk-rafaga') {
                        e.preventDefault();
                        _focusBox(prcInp);
                        return;
                    }
                }

                // Secuencia paso a paso con ENTER: cada recuadro avanza al siguiente hasta llegar a Guardar automáticamente
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var codVal = codInp ? String(codInp.value || '').trim() : '';

                    if (tId === 'exp-mode-pieza' || tId === 'exp-mode-granel') {
                        _focusBox(codInp);
                        return;
                    }
                    if (tId === 'exp-codigo' || tId === 'exp-btn-gen-codigo') {
                        if (!codVal || tId === 'exp-btn-gen-codigo') {
                            if (typeof global.expF1GenerateCode === 'function') {
                                global.expF1GenerateCode();
                                return;
                            }
                        }
                        _focusBox(nomInp);
                        return;
                    }
                    if (tId === 'exp-nombre') {
                        _focusBox(cosInp);
                        return;
                    }
                    if (tId === 'exp-costo') {
                        _focusBox(utiInp);
                        return;
                    }
                    if (tId === 'exp-utilidad') {
                        _focusBox(prcInp);
                        return;
                    }
                    if (tId === 'exp-precio-final' || tId === 'exp-btn-guardar' || tId === 'exp-chk-rafaga') {
                        global.expF1SaveProduct();
                        return;
                    }
                    // Si por cualquier motivo el foco quedó en el contenedor del modal y ya hay datos listos -> Guardar
                    if (codVal && nomInp && String(nomInp.value || '').trim() && prcInp && parseFloat(prcInp.value) > 0) {
                        global.expF1SaveProduct();
                        return;
                    }
                    _focusBox(codInp);
                    return;
                }
                return;
            }

            // 6. Cerrar cualquier otro modal abierto con ESC
            if (e.key === 'Escape' && isAnyModalOpen()) {
                e.preventDefault();
                ['modal-pc-existencias', 'modal-pc-quick-filter', 'modal-detalle-producto', 'modal-paquetes-f10', 'modal-producto-express-f1'].forEach(_closeModalById);
                keepSearchInputFocused(false);
                return;
            }

            // Si el modal de Paquetes [F10] está abierto, F10 guarda o cierra y no dispara otros atajos de tabla
            if (_isModalOpenById('modal-paquetes-f10')) {
                if (e.key === 'F10') {
                    e.preventDefault();
                    global.pktF10SavePackage();
                }
                return;
            }

            // Teclas de función F1, F4, F5, F6, F7, F8, F9, F10, F12 funcionan siempre en la pantalla de productos
            if (e.key === 'F1') {
                e.preventDefault();
                global.productsOpenExpressF1();
                return;
            }
            if (e.key === 'F4') {
                e.preventDefault();
                global.productsFamilia();
                return;
            }
            if (e.key === 'F5') {
                e.preventDefault();
                global.productsDepartamento();
                return;
            }
            if (e.key === 'F6') {
                e.preventDefault();
                global.productsMarca();
                return;
            }
            if (e.key === 'F7' || (e.ctrlKey && (e.key === 'o' || e.key === 'O'))) {
                e.preventDefault();
                global.productsOfertas();
                return;
            }
            if (e.key === 'F8') {
                e.preventDefault();
                global.productsStock();
                return;
            }
            if (e.key === 'F9') {
                e.preventDefault();
                global.productsClearFilters();
                return;
            }
            if (e.key === 'F10') {
                e.preventDefault();
                global.productsPaquetes();
                return;
            }
            if (e.key === 'F12') {
                e.preventDefault();
                global.productsKardex();
                return;
            }

            if (isAnyModalOpen()) return;

            // Permitir ↑/↓ incluso cuando el cursor está fijo en #products-search-input
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!_filtered.length) return;
                e.preventDefault();
                var curIdx = _filtered.findIndex(function (p) { return p.sku === _selectedSku; });
                var nextIdx = e.key === 'ArrowDown'
                    ? Math.min(_filtered.length - 1, curIdx + 1)
                    : Math.max(0, curIdx - 1);
                if (nextIdx >= 0 && _filtered[nextIdx]) {
                    selectRow(_filtered[nextIdx].sku, true);
                }
                keepSearchInputFocused(true);
                return;
            }

            // Si el buscador está vacío y el usuario presiona ESPACIO, marcar/desmarcar el producto actual
            var searchInp = document.getElementById('products-search-input');
            var searchEmpty = !searchInp || !String(searchInp.value || '').trim();
            if ((e.key === ' ' || e.code === 'Space') && (!inInput || (e.target === searchInp && searchEmpty))) {
                e.preventDefault();
                toggleCheckSku(_selectedSku);
                return;
            }

            if (inInput && e.target !== searchInp) return;

            if (e.key === 'Insert') {
                e.preventDefault();
                global.productsNuevoProducto();
            } else if (e.key === 'Enter' && searchEmpty) {
                e.preventDefault();
                global.productsEditar();
            } else if (e.key === 'Delete' && searchEmpty) {
                e.preventDefault();
                global.productsEliminar();
            }
        });
    }

    // ========================================================================
    // HANDLERS GLOBALES (CSP-SAFE DATA-CLICK / DATA-CHANGE / DATA-INPUT)
    // ========================================================================
    global.productsSearch = function (argOrEl) {
        var inp = document.getElementById('products-search-input');
        var q = typeof argOrEl === 'string'
            ? argOrEl.trim()
            : (argOrEl && argOrEl.value !== undefined ? String(argOrEl.value).trim() : String((inp && inp.value) || '').trim());
        _retainedSearchQuery = q;
        var clearBtn = document.getElementById('products-search-clear');
        if (clearBtn) clearBtn.style.display = (inp && inp.value) ? 'inline-flex' : 'none';
        applyClientFilters(null, _retainedSearchQuery);
        scheduleSearchAutoClear4s();
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(function () {
            syncSearchFromBackend(q, false);
        }, 220);
        keepSearchInputFocused(true);
    };

    global.productsSearchNow = function () {
        clearTimeout(_searchTimer);
        var inp = document.getElementById('products-search-input');
        var typedVal = String((inp && inp.value) || '').trim();
        var q = typedVal || _retainedSearchQuery;
        _retainedSearchQuery = q;
        var clearBtn = document.getElementById('products-search-clear');
        if (clearBtn) clearBtn.style.display = (inp && inp.value) ? 'inline-flex' : 'none';
        applyClientFilters(null, q);
        scheduleSearchAutoClear4s();
        syncSearchFromBackend(q, true);
        keepSearchInputFocused(true);
    };

    global.productsSearchClear = function () {
        clearTimeout(_searchTimer);
        clearTimeout(_inactivityClearTimer);
        _retainedSearchQuery = '';
        var inp = document.getElementById('products-search-input');
        if (inp) {
            inp.value = '';
        }
        var clearBtn = document.getElementById('products-search-clear');
        if (clearBtn) clearBtn.style.display = 'none';
        applyClientFilters(null, '');
        keepSearchInputFocused(true);
    };

    global.productsFilterChange = function () {
        applyClientFilters();
        keepSearchInputFocused(false);
    };

    global.productsBranchOrScaleChange = function () {
        applyClientFilters();
        keepSearchInputFocused(false);
    };

    global.productsClearFilters = function () {
        clearTimeout(_inactivityClearTimer);
        var hadChecked = _checked && _checked.size > 0;
        if (_checked) {
            _checked.clear();
        }
        _retainedSearchQuery = '';
        _onlyPromo = false;
        var sucSel = document.getElementById('pc-f-sucursal');
        var escSel = document.getElementById('pc-f-escala');
        var sucEscSel = document.getElementById('pc-f-sucursal-escala');
        if (sucSel) sucSel.value = 'MATRIZ';
        if (escSel) escSel.value = 'PRECIO DE LISTA';
        if (sucEscSel) sucEscSel.value = 'MATRIZ||PRECIO DE LISTA';
        ['pc-f-familia', 'pc-f-depto', 'pc-f-marca', 'pc-f-estado'].forEach(function (id) {
            var s = document.getElementById(id);
            if (s) s.value = '';
        });
        var inp = document.getElementById('products-search-input');
        var clearBtn = document.getElementById('products-search-clear');
        if (inp) inp.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        applyClientFilters(null, '');
        keepSearchInputFocused(true);
        if (typeof global.showToast === 'function') {
            global.showToast(
                hadChecked
                    ? 'Casillas desmarcadas y filtros restablecidos [F9].'
                    : 'Filtros restablecidos a MATRIZ - PRECIO PÚBLICO [F9].',
                'info'
            );
        }
    };

    global.productsSelectRow = function (elOrArg, arg) {
        var sku = typeof elOrArg === 'string' ? elOrArg : (arg || (elOrArg && elOrArg.getAttribute && elOrArg.getAttribute('data-sku')));
        selectRow(sku, false);
    };

    global.productsEditRow = function (elOrArg, arg) {
        var sku = typeof elOrArg === 'string' ? elOrArg : (arg || (elOrArg && elOrArg.getAttribute && elOrArg.getAttribute('data-sku')));
        if (sku) {
            _selectedSku = sku;
            editSelected(sku);
        }
    };

    global.productsToggleCheck = function (evOrEl, skuArg) {
        var el = (evOrEl && evOrEl.target) ? evOrEl.target : evOrEl;
        var sku = skuArg || (el && el.getAttribute && (el.getAttribute('data-change-arg') || el.getAttribute('data-sku')));
        if (!sku) return;
        if (el && el.checked) _checked.add(sku);
        else _checked.delete(sku);
        var row = el && el.closest ? el.closest('.pc-row') : null;
        if (row) row.classList.toggle('chk-row', Boolean(el && el.checked));
        updateCheckedCounter();
    };

    global.productsToggleAll = function (evOrEl) {
        var el = (evOrEl && evOrEl.target) ? evOrEl.target : evOrEl;
        if (el && el.checked) {
            _filtered.forEach(function (p) { _checked.add(p.sku); });
        } else {
            _checked.clear();
        }
        renderTable(_filtered);
    };

    // Acciones principales de la barra
    global.productsNuevoProducto = function () {
        goAlta(null);
    };

    global.productsEditar = function () {
        editSelected();
    };

    global.productsEliminar = function () {
        deleteSelectedProducts();
    };

    global.productsFamilia = function () {
        openQuickFilterModal('familia');
    };

    global.productsDepartamento = function () {
        openQuickFilterModal('depto');
    };

    global.productsMarca = function () {
        openQuickFilterModal('marca');
    };

    global.productsMarcar = function () {
        openQuickFilterModal('marca');
    };

    global.productsMarcarEspacio = function () {
        toggleCheckSku(_selectedSku);
    };

    global.productsOfertas = function () {
        _onlyPromo = !_onlyPromo;
        var estSel = document.getElementById('pc-f-estado');
        if (estSel) {
            estSel.value = _onlyPromo ? 'ofertas' : '';
        }
        applyClientFilters();
        if (_onlyPromo && _filtered.length === 0 && typeof global.showToast === 'function') {
            global.showToast('Filtro Ofertas [F7] activo: no hay productos con promoción vigente (F9 para ver todos).', 'info');
        }
    };

    // F8 -> Abre el recuadro de EXISTENCIAS POR SUCURSAL Y ALMACÉN
    global.productsStock = function () {
        openStockPorSucursalModal(_selectedSku);
    };

    global.productsOpenStockSku = function (elOrSku, skuArg) {
        var sku = typeof elOrSku === 'string' ? elOrSku : (skuArg || (elOrSku && elOrSku.getAttribute && elOrSku.getAttribute('data-click-arg')) || _selectedSku);
        openStockPorSucursalModal(sku);
    };

    // F12 -> Abre el KARDEX (ÚNICAMENTE de los productos seleccionados con checkbox [✓] o ESPACIO)
    global.productsKardex = function () {
        openKardexModal(Array.from(_checked));
    };

    global.productsOpenKardexSku = function (elOrSku, skuArg) {
        var sku = typeof elOrSku === 'string' ? elOrSku : (skuArg || (elOrSku && elOrSku.getAttribute && elOrSku.getAttribute('data-click-arg')) || '');
        if (sku) {
            openKardexModal([sku]);
        } else {
            openKardexModal(Array.from(_checked));
        }
    };

    global.productsExOpenKardex = function () {
        _closeModalById('modal-pc-existencias');
        if (_checked && _checked.size > 0) {
            openKardexModal(Array.from(_checked));
        } else if (_selectedSku) {
            openKardexModal([_selectedSku]);
        } else {
            openKardexModal([]);
        }
    };

    // Handlers del modal de Kardex (F12)
    global.productsKardexFilterChange = function () {
        renderKardexRows();
    };

    global.productsKardexResetFilters = function () {
        if (_kdxCheckedIds) {
            _kdxCheckedIds.clear();
        }
        var chkAll = document.getElementById('pc-kdx-chk-all');
        if (chkAll) chkAll.checked = false;
        var prodSel = document.getElementById('pc-kdx-product');
        var scopeSel = document.getElementById('pc-kdx-scope');
        var flowSel = document.getElementById('pc-kdx-flow');
        var dateFromEl = document.getElementById('pc-kdx-date-from');
        var dateToEl = document.getElementById('pc-kdx-date-to');
        var searchInp = document.getElementById('pc-kdx-search');
        var selSkus = (_kdxData && Array.isArray(_kdxData.selectedSkus)) ? _kdxData.selectedSkus : [];
        if (prodSel) prodSel.value = selSkus.length === 1 ? selSkus[0] : 'SELECTED_ALL';
        if (scopeSel) scopeSel.value = 'AMBAS';
        if (flowSel) flowSel.value = 'ALL';
        if (dateFromEl) dateFromEl.value = '';
        if (dateToEl) dateToEl.value = '';
        if (searchInp) searchInp.value = '';
        renderKardexRows();
    };

    global.productsKardexSelectRow = function (elOrIdx, idxArg) {
        var idx = typeof elOrIdx === 'number' || typeof elOrIdx === 'string'
            ? elOrIdx
            : (idxArg !== undefined ? idxArg : (elOrIdx && elOrIdx.getAttribute && elOrIdx.getAttribute('data-kdx-idx')));
        selectKardexRowByIndex(idx, false);
    };

    global.productsKardexToggleRowCheck = function (evOrEl, idxArg) {
        var el = (evOrEl && evOrEl.target) ? evOrEl.target : evOrEl;
        var idx = idxArg !== undefined
            ? idxArg
            : (el && el.getAttribute && (el.getAttribute('data-change-arg') || el.getAttribute('data-kdx-idx')));
        selectKardexRowByIndex(idx, false);
        toggleKardexRowCheckByIndex(idx, el ? Boolean(el.checked) : undefined);
    };

    global.productsKardexToggleAll = function (evOrEl) {
        var el = (evOrEl && evOrEl.target) ? evOrEl.target : evOrEl;
        var checkAll = Boolean(el && el.checked);
        _kdxFilteredRows.forEach(function (r, idx) {
            var k = _getKdxRowKey(r, idx);
            if (checkAll) _kdxCheckedIds.add(k);
            else _kdxCheckedIds.delete(k);
        });
        renderKardexRows();
    };

    global.productsKardexOpenDocByIdx = function (elOrIdx, idxArg) {
        var idx = typeof elOrIdx === 'number' || typeof elOrIdx === 'string'
            ? elOrIdx
            : (idxArg !== undefined ? idxArg : (elOrIdx && elOrIdx.getAttribute && (elOrIdx.getAttribute('data-click-arg') || elOrIdx.getAttribute('data-dblclick-arg') || elOrIdx.getAttribute('data-kdx-idx'))));
        var cleanIdx = parseInt(idx, 10) || 0;
        selectKardexRowByIndex(cleanIdx, false);
        if (_kdxFilteredRows[cleanIdx]) {
            openKardexDocumentModal(_kdxFilteredRows[cleanIdx]);
        }
    };

    global.productsKardexOpenActiveDoc = function () {
        if (_kdxFilteredRows[_kdxActiveIndex]) {
            openKardexDocumentModal(_kdxFilteredRows[_kdxActiveIndex]);
        } else if (_kdxFilteredRows.length > 0) {
            openKardexDocumentModal(_kdxFilteredRows[0]);
        } else {
            showCalebsysAlertModal('Sin Movimientos', 'No hay movimientos listados en el Kardex actual para abrir su documento.', '');
        }
    };

    global.productsKardexDocPrint = function () {
        printKardexSingleDocument();
    };

    global.productsKardexDocToggleEdit = function () {
        var panel = document.getElementById('pc-kdoc-edit-panel');
        if (!panel) return;
        var isHidden = panel.style.display === 'none' || !panel.style.display;
        panel.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            _initKdocSignatureCanvas();
            panel.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    };

    global.productsKardexDocClearCanvas = function () {
        var canvas = document.getElementById('pc-kdoc-sig-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _kdxSigHasDrawn = false;
    };

    global.productsKardexDocSaveMeta = async function () {
        if (!_kdxActiveDocData) return;
        var llevo = (document.getElementById('pc-kdoc-inp-llevo') || {}).value || '';
        var recibio = (document.getElementById('pc-kdoc-inp-recibio') || {}).value || '';
        var ref = (document.getElementById('pc-kdoc-inp-ref') || {}).value || '';
        var unidad = (document.getElementById('pc-kdoc-inp-unidad') || {}).value || '';
        var obs = (document.getElementById('pc-kdoc-inp-obs') || {}).value || '';
        var canvas = document.getElementById('pc-kdoc-sig-canvas');
        var sigDataUrl = (_kdxSigHasDrawn && canvas) ? canvas.toDataURL('image/png') : (_kdxActiveDocData.signature_info && _kdxActiveDocData.signature_info.firma_data_url) || '';

        try {
            var res = await fetch('/api/products-f3/kardex-document-meta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    doc_key: _kdxActiveDocData.doc_key || _kdxActiveDocData.folio || 'DOC',
                    quien_llevo: llevo,
                    quien_recibio: recibio,
                    referencia: ref,
                    unidad_transporte: unidad,
                    observaciones_entrega: obs,
                    firma_data_url: sigDataUrl,
                    firmante_nombre: recibio
                })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (_kdxActiveDocData.delivery_info) {
                _kdxActiveDocData.delivery_info.quien_llevo = llevo;
                _kdxActiveDocData.delivery_info.quien_recibio = recibio;
                _kdxActiveDocData.delivery_info.unidad_transporte = unidad;
                _kdxActiveDocData.delivery_info.observaciones = obs;
            }
            if (_kdxActiveDocData.payment) {
                _kdxActiveDocData.payment.reference = ref;
            }
            if (_kdxActiveDocData.signature_info) {
                _kdxActiveDocData.signature_info.firmante_nombre = recibio;
                if (sigDataUrl) _kdxActiveDocData.signature_info.firma_data_url = sigDataUrl;
                _kdxActiveDocData.signature_info.firma_fecha = new Date().toLocaleString('es-MX');
            }
            renderKardexDocumentView(_kdxActiveDocData);
            toast('Datos de entrega, referencia y firma virtual guardados en el documento.', 'success');
        } catch (err) {
            console.error('[CALEBSYS] Error guardando metadatos del documento:', err);
            toast('No se pudo guardar en servidor, actualizado en vista.', 'warning');
        }
    };

    global.productsKardexExportCSV = function () {
        exportKardexExcel();
    };

    global.productsKardexExportExcel = function () {
        exportKardexExcel();
    };

    global.productsKardexPrint = function () {
        printKardexReport();
    };

    global.productsKardexOpenSendModal = function () {
        openKardexSendModal('WHATSAPP');
    };

    global.productsKardexSelectSendChannel = function (elOrChan, chanArg) {
        var ch = typeof elOrChan === 'string' ? elOrChan : (chanArg || (elOrChan && elOrChan.getAttribute && elOrChan.getAttribute('data-click-arg')) || 'WHATSAPP');
        selectKardexSendChannel(ch);
    };

    global.productsKardexConfirmSend = function () {
        confirmKardexSend();
    };

    global.productsKardexToggleSendMenu = function () {
        openKardexSendModal('WHATSAPP');
    };

    global.productsKardexSendWhatsApp = function () {
        openKardexSendModal('WHATSAPP');
    };

    global.productsKardexSendEmail = function () {
        openKardexSendModal('EMAIL');
    };

    // Handlers del modal de filtro rápido (F4 / F5 / F6)
    global.productsQuickFilterSearch = function (argOrEl) {
        var val = typeof argOrEl === 'string' ? argOrEl : (argOrEl && argOrEl.value ? argOrEl.value : '');
        renderQuickFilterList(val);
    };

    global.productsQuickFilterPick = function (elOrVal, valArg) {
        var v = typeof elOrVal === 'string' ? elOrVal : (valArg !== undefined ? valArg : (elOrVal && elOrVal.getAttribute ? elOrVal.getAttribute('data-click-arg') : ''));
        pickQuickFilterValue(v);
    };

    global.productsQuickFilterClear = function () {
        pickQuickFilterValue('');
    };

    global.productsPreciosSucursales = function () {
        editSelected();
    };

    global.productsOfertasCalendarizadas = function () {
        global.productsOfertas();
    };

    global.openProductDetailModal = function (sku) {
        openStockPorSucursalModal(sku);
    };

    // ========================================================================
    // MÓDULO [F10]: ARMADOR Y CATÁLOGO DE PAQUETES / KITS / RECETAS
    // ========================================================================
    var _pktF10Components = [];
    var _pktF10SelectedCandidate = null;
    var _pktF10DropdownMatches = [];
    var _pktF10DropdownIdx = 0;
    var _pktF10KeyEventsBound = false;

    function _getComponentFloorCostIva(p) {
        if (!p) return 0;
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var directFloor = parseFloat(m.costo_piso_iva || p.costo_piso_iva || 0);
        if (directFloor > 0) return Math.round(directFloor * 100) / 100;

        var rawCost = parseFloat(
            m.costo_con_flete != null ? m.costo_con_flete :
            (p.average_cost != null ? p.average_cost :
            (m.costo != null ? m.costo : (parseFloat(p.price || 0) * 0.72)))
        ) || 0;
        var ivaPct = parseFloat(p.tax_rate != null ? p.tax_rate : (m.iva != null ? m.iva : 16));
        if (isNaN(ivaPct) || ivaPct < 0) ivaPct = 16;
        var iepsPct = parseFloat(m.ieps != null ? m.ieps : 0) || 0;
        var floorWithTax = rawCost;
        if (m.costo_con_flete != null || m.iva != null) {
            floorWithTax = rawCost * (1 + ivaPct / 100) * (1 + iepsPct / 100);
        }
        var normalPrice = parseFloat(p.price || 0) || 0;
        if (normalPrice > 0 && floorWithTax > normalPrice) {
            floorWithTax = rawCost;
        }
        return Math.round(floorWithTax * 100) / 100;
    }

    function _getComponentNormalPrice(p, branchVal, scaleVal) {
        if (!p) return 0;
        var bName = (!branchVal || branchVal === 'TODAS') ? 'MATRIZ' : String(branchVal).trim().toUpperCase();
        var sName = String(scaleVal || 'PRECIO DE LISTA').trim().toUpperCase();
        var selObj = {
            branch_name: bName,
            scale_name: sName,
            pretty_scale: formatPublicScaleLabel(sName)
        };
        var pr = getProductEffectivePriceForSelection(p, selObj);
        return Math.round((parseFloat(pr) || 0) * 100) / 100;
    }

    function _populatePktF10Branches() {
        var sel = document.getElementById('pkt-f10-branch');
        if (!sel) return;
        var cur = sel.value || 'TODAS';
        var seen = { 'TODAS': true, 'MATRIZ': true };
        var html = '<option value="TODAS">🌐 Todas las Sucursales</option>' +
                   '<option value="MATRIZ">🏢 Exclusivo MATRIZ</option>';
        var sourceList = _masterProducts.length ? _masterProducts : _allProducts;
        sourceList.forEach(function (p) {
            var m = (p && p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
            if (Array.isArray(m.branches_list)) {
                m.branches_list.forEach(function (b) {
                    var nm = String((b && (b.name || b.id)) || '').trim().toUpperCase();
                    if (nm && !seen[nm]) {
                        seen[nm] = true;
                        html += '<option value="' + escapeHtml(nm) + '">🏪 ' + escapeHtml(nm) + '</option>';
                    }
                });
            }
            if (Array.isArray(m.branch_price_scales)) {
                m.branch_price_scales.forEach(function (bs) {
                    var nm = String((bs && (bs.branch_name || bs.branch_id)) || '').trim().toUpperCase();
                    if (nm && !seen[nm]) {
                        seen[nm] = true;
                        html += '<option value="' + escapeHtml(nm) + '">🏪 ' + escapeHtml(nm) + '</option>';
                    }
                });
            }
        });
        sel.innerHTML = html;
        if (seen[cur]) sel.value = cur;
    }

    function _bindPktF10InputsOnce() {
        if (_pktF10KeyEventsBound) return;
        var searchInp = document.getElementById('pkt-f10-search-inp');
        var qtyInp = document.getElementById('pkt-f10-add-qty');
        if (!searchInp || !qtyInp) return;
        _pktF10KeyEventsBound = true;

        searchInp.addEventListener('keydown', function (ev) {
            var dd = document.getElementById('pkt-f10-search-dd');
            var ddOpen = dd && dd.style.display !== 'none' && _pktF10DropdownMatches.length > 0;
            if (ev.key === 'ArrowDown' && ddOpen) {
                ev.preventDefault();
                _pktF10DropdownIdx = Math.min(_pktF10DropdownMatches.length - 1, _pktF10DropdownIdx + 1);
                _renderPktF10SearchDropdown();
            } else if (ev.key === 'ArrowUp' && ddOpen) {
                ev.preventDefault();
                _pktF10DropdownIdx = Math.max(0, _pktF10DropdownIdx - 1);
                _renderPktF10SearchDropdown();
            } else if (ev.key === 'Enter') {
                ev.preventDefault();
                if (ddOpen && _pktF10DropdownMatches[_pktF10DropdownIdx]) {
                    global.pktF10PickSearchItem(_pktF10DropdownMatches[_pktF10DropdownIdx].sku);
                } else if (_pktF10SelectedCandidate) {
                    qtyInp.focus();
                    qtyInp.select();
                }
            } else if (ev.key === 'Escape' && ddOpen) {
                ev.preventDefault();
                ev.stopPropagation();
                dd.style.display = 'none';
            }
        });

        qtyInp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                global.pktF10AddComponentBtn();
            }
        });

        ['pkt-f10-disc-pct', 'pkt-f10-final-price'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('focus', function () {
                try { el.select(); } catch (e) {}
            });
            el.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    if (id === 'pkt-f10-disc-pct') {
                        var fp = document.getElementById('pkt-f10-final-price');
                        if (fp) { fp.focus(); fp.select(); }
                    } else {
                        var sv = document.getElementById('pkt-f10-save-btn');
                        if (sv) sv.focus();
                    }
                }
            });
        });
    }

    function _generateAutoPktSku() {
        var sourceList = (_masterProducts.length ? _masterProducts : _allProducts).concat(_loadLocalPackagesCatalog());
        var maxNum = 0;
        sourceList.forEach(function (p) {
            var s = String((p && p.sku) || '').trim().toUpperCase();
            var m = s.match(/^PKT-(\d+)$/);
            if (m) {
                var n = parseInt(m[1], 10);
                if (n > maxNum) maxNum = n;
            }
        });
        var next = maxNum + 1;
        return 'PKT-' + String(next).padStart(3, '0');
    }

    function _renderPktF10SearchDropdown() {
        var dd = document.getElementById('pkt-f10-search-dd');
        if (!dd) return;
        if (!_pktF10DropdownMatches.length) {
            dd.style.display = 'none';
            dd.innerHTML = '';
            return;
        }
        var branchVal = (document.getElementById('pkt-f10-branch') || {}).value || 'TODAS';
        var scaleVal = (document.getElementById('pkt-f10-scale') || {}).value || 'PRECIO DE LISTA';
        var html = '';
        _pktF10DropdownMatches.forEach(function (p, idx) {
            var isSel = idx === _pktF10DropdownIdx;
            var skuEsc = escapeHtml(p.sku);
            var nameEsc = escapeHtml(p.name || p.description || p.sku);
            var st = getProductEffectiveStockForBranch(p, branchVal === 'TODAS' ? 'MATRIZ' : branchVal);
            var floorIva = _getComponentFloorCostIva(p);
            var unitNormal = _getComponentNormalPrice(p, branchVal, scaleVal);
            html +=
                '<div data-click="pktF10PickSearchItem" data-click-arg="' + skuEsc + '" ' +
                     'style="padding:7px 10px;cursor:pointer;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;background:' + (isSel ? '#e0f2fe' : '#ffffff') + ';">' +
                    '<div>' +
                        '<span style="font-family:monospace;font-weight:900;color:#0369a1;background:#f0f9ff;padding:1px 6px;border-radius:4px;border:1px solid #bae6fd;margin-right:8px;">' + skuEsc + '</span>' +
                        '<strong style="color:#0f172a;font-size:12px;">' + nameEsc + '</strong>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:12px;font-size:11px;">' +
                        '<span style="color:#475569;">Stock: <strong style="color:' + (st > 0 ? '#15803d' : '#dc2626') + ';">' + fmtQty(st) + '</strong></span>' +
                        '<span style="color:#92400e;">Piso c/IVA: <strong>' + fmtMoney(floorIva) + '</strong></span>' +
                        '<span style="color:#0f172a;font-weight:900;">Precio: ' + fmtMoney(unitNormal) + '</span>' +
                    '</div>' +
                '</div>';
        });
        dd.innerHTML = html;
        dd.style.display = 'block';
    }

    function _renderPktF10ComponentsTable() {
        var tbody = document.getElementById('pkt-f10-items-tbody');
        var counter = document.getElementById('pkt-f10-items-counter');
        if (!tbody) return;

        var branchVal = (document.getElementById('pkt-f10-branch') || {}).value || 'TODAS';
        var scaleVal = (document.getElementById('pkt-f10-scale') || {}).value || 'PRECIO DE LISTA';

        // Refresh prices and floor costs from catalog products if available
        var sourceList = _masterProducts.length ? _masterProducts : _allProducts;
        _pktF10Components.forEach(function (c) {
            var found = sourceList.find(function (p) { return String(p.sku).toUpperCase() === String(c.sku).toUpperCase(); });
            if (found) {
                c.name = found.name || found.description || c.name || c.sku;
                c.stock = getProductEffectiveStockForBranch(found, branchVal === 'TODAS' ? 'MATRIZ' : branchVal);
                c.floor_cost_iva = _getComponentFloorCostIva(found);
                c.unit_price_normal = _getComponentNormalPrice(found, branchVal, scaleVal);
                c.sale_unit = found.sale_unit || c.sale_unit || 'PIEZA';
                c.product_id = found.id || c.product_id || null;
            }
        });

        var totalUnits = _pktF10Components.reduce(function (acc, c) { return acc + (parseFloat(c.qty) || 0); }, 0);
        if (counter) {
            counter.textContent = _pktF10Components.length + (_pktF10Components.length === 1 ? ' producto (' : ' productos (') + fmtQty(totalUnits) + ' u. totales)';
        }

        if (!_pktF10Components.length) {
            tbody.innerHTML =
                '<tr>' +
                    '<td colspan="8" style="padding:20px;text-align:center;color:#64748b;font-weight:600;">' +
                        'Busca y agrega productos arriba (ej. Mufa, Tubo Conduit, Base Medidor, Cable...) para armar el paquete.' +
                    '</td>' +
                '</tr>';
            return;
        }

        var html = '';
        _pktF10Components.forEach(function (c, idx) {
            var qty = parseFloat(c.qty) || 1;
            var floorIva = parseFloat(c.floor_cost_iva) || 0;
            var unitNormal = parseFloat(c.unit_price_normal) || 0;
            var subNormal = Math.round(qty * unitNormal * 100) / 100;
            var st = parseFloat(c.stock) || 0;
            var skuEsc = escapeHtml(c.sku);
            html +=
                '<tr style="border-bottom:1px solid #e2e8f0;background:' + (idx % 2 === 0 ? '#ffffff' : '#f8fafc') + ';">' +
                    '<td style="padding:6px 8px;font-family:monospace;font-weight:800;color:#0f172a;">' + skuEsc + '</td>' +
                    '<td style="padding:6px 8px;font-weight:700;color:#0f172a;">' + escapeHtml(c.name) + ' <span style="font-size:10px;color:#64748b;">(' + escapeHtml(c.sale_unit || 'PZA') + ')</span></td>' +
                    '<td style="padding:6px 8px;text-align:center;">' +
                        '<span style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:999px;background:' + (st >= qty ? '#dcfce7' : '#fee2e2') + ';color:' + (st >= qty ? '#15803d' : '#b91c1c') + ';">' +
                            fmtQty(st) +
                        '</span>' +
                    '</td>' +
                    '<td style="padding:5px 8px;text-align:center;background:#eff6ff;">' +
                        '<input type="number" value="' + qty + '" min="0.01" step="any" data-input="pktF10UpdateItemQty" data-idx="' + idx + '" ' +
                               'style="width:92px;height:28px;text-align:center;font-weight:900;font-size:12px;border:1.5px solid #0284c7;border-radius:6px;color:#0f172a;background:#ffffff;">' +
                    '</td>' +
                    '<td style="padding:6px 8px;text-align:right;font-family:monospace;font-weight:800;color:#b45309;">' + fmtMoney(floorIva) + '</td>' +
                    '<td style="padding:6px 8px;text-align:right;font-family:monospace;font-weight:800;color:#0f172a;">' + fmtMoney(unitNormal) + '</td>' +
                    '<td style="padding:6px 8px;text-align:right;font-family:monospace;font-weight:900;color:#0369a1;">' + fmtMoney(subNormal) + '</td>' +
                    '<td style="padding:6px 8px;text-align:center;">' +
                        '<button type="button" data-click="pktF10RemoveComponent" data-click-arg="' + idx + '" title="Quitar del paquete" ' +
                                'style="border:none;background:#fee2e2;color:#dc2626;width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:12px;">' +
                            '<i class="fa-solid fa-trash"></i>' +
                        '</button>' +
                    '</td>' +
                '</tr>';
        });
        tbody.innerHTML = html;
    }

    function _recalcPktF10Financials(triggerSource) {
        var sumNormal = 0;
        var sumFloor = 0;
        _pktF10Components.forEach(function (c) {
            var q = parseFloat(c.qty) || 0;
            sumNormal += q * (parseFloat(c.unit_price_normal) || 0);
            sumFloor += q * (parseFloat(c.floor_cost_iva) || 0);
        });
        sumNormal = Math.round(sumNormal * 100) / 100;
        sumFloor = Math.round(sumFloor * 100) / 100;

        var discInp = document.getElementById('pkt-f10-disc-pct');
        var finalInp = document.getElementById('pkt-f10-final-price');
        var sumNormalEl = document.getElementById('pkt-f10-sum-normal');
        var sumFloorEl = document.getElementById('pkt-f10-sum-floor');
        var profitEl = document.getElementById('pkt-f10-net-profit');
        var savingsEl = document.getElementById('pkt-f10-savings-lbl');
        var ptsBadge = document.getElementById('pkt-f10-pts-badge');
        var alertEl = document.getElementById('pkt-f10-floor-alert');

        if (sumNormalEl) sumNormalEl.textContent = fmtMoney(sumNormal);
        if (sumFloorEl) sumFloorEl.textContent = fmtMoney(sumFloor);

        var discPct = parseFloat(discInp ? discInp.value : 0) || 0;
        var finalPrice = parseFloat(finalInp ? finalInp.value : 0) || 0;

        if (sumNormal <= 0) {
            if (discInp && triggerSource !== 'disc') discInp.value = '0.00';
            if (finalInp && triggerSource !== 'final') finalInp.value = '0.00';
            if (profitEl) profitEl.textContent = '$0.00 (0.0%)';
            if (savingsEl) savingsEl.textContent = 'Ahorro cliente: $0.00';
            if (alertEl) alertEl.style.display = 'none';
            return { valid: true, sumNormal: 0, sumFloor: 0, finalPrice: 0, discPct: 0 };
        }

        if (triggerSource === 'final') {
            if (finalPrice < 0) finalPrice = 0;
            discPct = sumNormal > 0 ? ((sumNormal - finalPrice) / sumNormal) * 100 : 0;
            if (discPct < 0) discPct = 0;
            if (discInp) discInp.value = discPct.toFixed(2);
        } else {
            if (discPct < 0) discPct = 0;
            if (discPct > 99.9) discPct = 99.9;
            finalPrice = Math.round(sumNormal * (1 - discPct / 100) * 100) / 100;
            if (finalInp && triggerSource !== 'final') finalInp.value = finalPrice.toFixed(2);
        }

        var profit = Math.round((finalPrice - sumFloor) * 100) / 100;
        var marginPct = sumFloor > 0 ? ((finalPrice - sumFloor) / sumFloor) * 100 : 0;
        var savings = Math.max(0, Math.round((sumNormal - finalPrice) * 100) / 100);

        if (profitEl) {
            profitEl.textContent = fmtMoney(profit) + ' (' + marginPct.toFixed(1) + '%)';
            profitEl.style.color = profit < 0 ? '#dc2626' : '#15803d';
        }
        if (savingsEl) {
            savingsEl.textContent = 'Ahorro cliente: ' + fmtMoney(savings) + ' (' + discPct.toFixed(2) + '%)';
        }
        if (ptsBadge) {
            if (discPct > 0.001) {
                ptsBadge.textContent = '🚫 0 Puntos en Descuento de Paquete';
                ptsBadge.style.background = '#fef2f2';
                ptsBadge.style.color = '#dc2626';
                ptsBadge.style.borderColor = '#fca5a5';
            } else {
                ptsBadge.textContent = '✅ Puntos Normales (0% Desc.)';
                ptsBadge.style.background = '#dcfce7';
                ptsBadge.style.color = '#15803d';
                ptsBadge.style.borderColor = '#86efac';
            }
        }

        // Validación estricta de Costo Piso Total y por Componente Individual
        var factor = sumNormal > 0 ? (finalPrice / sumNormal) : 1;
        var violatedComponent = null;
        for (var i = 0; i < _pktF10Components.length; i++) {
            var comp = _pktF10Components[i];
            var compUnitDisc = Math.round((parseFloat(comp.unit_price_normal) || 0) * factor * 100) / 100;
            var compFloor = parseFloat(comp.floor_cost_iva) || 0;
            if (compFloor > 0 && compUnitDisc + 0.009 < compFloor) {
                violatedComponent = {
                    sku: comp.sku,
                    name: comp.name,
                    unitDisc: compUnitDisc,
                    floor: compFloor
                };
                break;
            }
        }

        var totalBelowFloor = sumFloor > 0 && (finalPrice + 0.009 < sumFloor);
        if (alertEl) {
            if (totalBelowFloor || violatedComponent) {
                alertEl.style.display = 'block';
                if (totalBelowFloor) {
                    alertEl.innerHTML = '⛔ <strong>CANDADO ANTI-PÉRDIDA ACTIVO:</strong> El Precio Final del Paquete (<strong>' + fmtMoney(finalPrice) + '</strong>) es menor al Costo Piso Total c/IVA (<strong>' + fmtMoney(sumFloor) + '</strong>). Ajusta el descuento para poder guardar.';
                } else if (violatedComponent) {
                    alertEl.innerHTML = '⛔ <strong>CANDADO ANTI-PÉRDIDA POR COMPONENTE:</strong> Con este descuento, el artículo <strong>[' + escapeHtml(violatedComponent.sku) + '] ' + escapeHtml(violatedComponent.name) + '</strong> bajaría a <strong>' + fmtMoney(violatedComponent.unitDisc) + '</strong>, por debajo de su Costo Piso c/IVA (<strong>' + fmtMoney(violatedComponent.floor) + '</strong>).';
                }
            } else {
                alertEl.style.display = 'none';
            }
        }

        return {
            valid: !(totalBelowFloor || violatedComponent),
            sumNormal: sumNormal,
            sumFloor: sumFloor,
            finalPrice: finalPrice,
            discPct: discPct,
            violatedComponent: violatedComponent
        };
    }

    function _getAllPackagesFromCatalog() {
        _syncLocalPackagesIntoMaster();
        var sourceList = _masterProducts.length ? _masterProducts : _allProducts;
        return sourceList.filter(isPackageKit);
    }

    function _renderPktF10SavedPackagesList() {
        var tbody = document.getElementById('pkt-f10-saved-tbody');
        var countEl = document.getElementById('pkt-f10-saved-count');
        if (!tbody) return;

        var packages = _getAllPackagesFromCatalog();
        if (countEl) {
            countEl.textContent = packages.length + (packages.length === 1 ? ' paquete registrado' : ' paquetes registrados');
        }

        if (!packages.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;color:#64748b;font-weight:600;">Aún no hay paquetes registrados. Crea el primero en el formulario.</td></tr>';
            return;
        }

        var html = '';
        packages.forEach(function (pkt) {
            var m = (pkt.meta_data && typeof pkt.meta_data === 'object') ? pkt.meta_data : {};
            var cfg = m.package_config || {};
            var comps = Array.isArray(cfg.components) ? cfg.components : [];
            var isAct = isActive(pkt) && cfg.active !== false;
            var disc = parseFloat(cfg.discount_pct || 0) || 0;
            var skuEsc = escapeHtml(pkt.sku);
            var vigTxt = cfg.vigencia_type === 'FECHAS'
                ? ('📅 ' + (cfg.start_date || '—') + ' a ' + (cfg.end_date || '—'))
                : '⚡ Permanente';

            html +=
                '<tr style="border-bottom:1px solid #e2e8f0;background:' + (isAct ? '#ffffff' : '#f8fafc') + ';opacity:' + (isAct ? '1' : '0.68') + ';">' +
                    '<td style="padding:6px 8px;font-family:monospace;font-weight:900;color:#0369a1;">' + skuEsc + '</td>' +
                    '<td style="padding:6px 8px;">' +
                        '<div style="font-weight:800;color:#0f172a;">' + escapeHtml(pkt.name || pkt.description || pkt.sku) + '</div>' +
                        '<div style="font-size:10px;color:#64748b;">' + escapeHtml(vigTxt) + (disc > 0 ? ' · <strong style="color:#d97706;">-' + disc.toFixed(1) + '% Desc.</strong>' : '') + '</div>' +
                    '</td>' +
                    '<td style="padding:6px 8px;text-align:center;font-weight:800;color:#1e40af;">' + comps.length + '</td>' +
                    '<td style="padding:6px 8px;text-align:right;font-family:monospace;font-weight:900;color:#15803d;">' + fmtMoney(pkt.price) + '</td>' +
                    '<td style="padding:6px 8px;text-align:center;white-space:nowrap;">' +
                        '<button type="button" data-click="pktF10EditSaved" data-click-arg="' + skuEsc + '" title="Editar paquete" style="border:1px solid #0284c7;background:#e0f2fe;color:#0369a1;border-radius:5px;padding:3px 6px;cursor:pointer;margin-right:3px;font-size:11px;"><i class="fa-solid fa-pen"></i></button>' +
                        '<button type="button" data-click="pktF10ToggleActiveSaved" data-click-arg="' + skuEsc + '" title="' + (isAct ? 'Pausar paquete' : 'Activar paquete') + '" style="border:1px solid #f59e0b;background:#fef3c7;color:#b45309;border-radius:5px;padding:3px 6px;cursor:pointer;margin-right:3px;font-size:11px;"><i class="fa-solid ' + (isAct ? 'fa-pause' : 'fa-play') + '"></i></button>' +
                        '<button type="button" data-click="pktF10DeleteSaved" data-click-arg="' + skuEsc + '" title="Eliminar paquete" style="border:1px solid #ef4444;background:#fee2e2;color:#dc2626;border-radius:5px;padding:3px 6px;cursor:pointer;font-size:11px;"><i class="fa-solid fa-trash"></i></button>' +
                    '</td>' +
                '</tr>';
        });
        tbody.innerHTML = html;
    }

    function openPaquetesModalF10(skuToLoad) {
        _syncLocalPackagesIntoMaster();
        _populatePktF10Branches();
        _bindPktF10InputsOnce();
        _renderPktF10SavedPackagesList();

        var selProd = skuToLoad
            ? (_allProducts.find(function (p) { return String(p.sku).toUpperCase() === String(skuToLoad).toUpperCase(); }))
            : getSelectedProduct();

        if (skuToLoad && selProd && isPackageKit(selProd)) {
            global.pktF10EditSaved(selProd.sku);
        } else if (!_pktF10Components.length && !(document.getElementById('pkt-f10-editing-id') || {}).value) {
            global.pktF10ResetForm();
        } else {
            _renderPktF10ComponentsTable();
            _recalcPktF10Financials('disc');
        }

        _openModalById('modal-paquetes-f10');
        setTimeout(function () {
            var nameInp = document.getElementById('pkt-f10-name');
            if (nameInp) nameInp.focus();
        }, 60);
    }

    global.productsPaquetes = function () {
        var sel = getSelectedProduct();
        if (sel && isPackageKit(sel)) {
            openPaquetesModalF10(sel.sku);
        } else {
            openPaquetesModalF10(null);
        }
    };

    global.pktF10GenerateCode = function () {
        var skuInp = document.getElementById('pkt-f10-sku');
        if (skuInp) {
            skuInp.value = _generateAutoPktSku();
        }
    };

    global.pktF10ResetForm = function () {
        _pktF10Components = [];
        _pktF10SelectedCandidate = null;
        _pktF10DropdownMatches = [];
        var editId = document.getElementById('pkt-f10-editing-id');
        var badge = document.getElementById('pkt-f10-edit-badge');
        var skuInp = document.getElementById('pkt-f10-sku');
        var nameInp = document.getElementById('pkt-f10-name');
        var typeSel = document.getElementById('pkt-f10-type');
        var branchSel = document.getElementById('pkt-f10-branch');
        var scaleSel = document.getElementById('pkt-f10-scale');
        var vigSel = document.getElementById('pkt-f10-vigencia');
        var dStart = document.getElementById('pkt-f10-date-start');
        var dEnd = document.getElementById('pkt-f10-date-end');
        var actSel = document.getElementById('pkt-f10-active');
        var discInp = document.getElementById('pkt-f10-disc-pct');
        var finalInp = document.getElementById('pkt-f10-final-price');
        var searchInp = document.getElementById('pkt-f10-search-inp');
        var chip = document.getElementById('pkt-f10-selected-chip');

        if (editId) editId.value = '';
        if (badge) badge.style.display = 'none';
        if (skuInp) skuInp.value = _generateAutoPktSku();
        if (nameInp) nameInp.value = '';
        if (typeSel) typeSel.value = 'PAQUETE_VENTA';
        if (branchSel) branchSel.value = 'TODAS';
        if (scaleSel) scaleSel.value = 'PRECIO DE LISTA';
        if (vigSel) vigSel.value = 'PERMANENTE';
        if (dStart) dStart.value = '';
        if (dEnd) dEnd.value = '';
        if (actSel) actSel.value = '1';
        if (discInp) discInp.value = '0.00';
        if (finalInp) finalInp.value = '0.00';
        if (searchInp) searchInp.value = '';
        if (chip) chip.style.display = 'none';

        global.pktF10OnVigenciaChange();
        _renderPktF10ComponentsTable();
        _recalcPktF10Financials('disc');
    };

    global.pktF10OnVigenciaChange = function () {
        var vig = (document.getElementById('pkt-f10-vigencia') || {}).value || 'PERMANENTE';
        var w1 = document.getElementById('pkt-f10-date-start-wrap');
        var w2 = document.getElementById('pkt-f10-date-end-wrap');
        var showDates = vig === 'FECHAS';
        if (w1) w1.style.display = showDates ? 'block' : 'none';
        if (w2) w2.style.display = showDates ? 'block' : 'none';
    };

    global.pktF10OnScaleChange = function () {
        _renderPktF10ComponentsTable();
        _recalcPktF10Financials('disc');
    };

    global.pktF10RecalcTotals = function () {
        _renderPktF10ComponentsTable();
        _recalcPktF10Financials('disc');
    };

    global.pktF10OnDiscPctInput = function () {
        _recalcPktF10Financials('disc');
    };

    global.pktF10OnFinalPriceInput = function () {
        _recalcPktF10Financials('final');
    };

    global.pktF10SearchInput = function (elOrVal) {
        var inp = document.getElementById('pkt-f10-search-inp');
        var q = typeof elOrVal === 'string'
            ? elOrVal.trim()
            : String((inp && inp.value) || '').trim();
        var chip = document.getElementById('pkt-f10-selected-chip');
        if (chip) chip.style.display = 'none';
        _pktF10SelectedCandidate = null;

        if (!q) {
            _pktF10DropdownMatches = [];
            _renderPktF10SearchDropdown();
            return;
        }

        var sourceList = _masterProducts.length ? _masterProducts : _allProducts;
        var matches = [];
        sourceList.forEach(function (p) {
            if (!p || isPackageKit(p)) return;
            var mInfo = _productMatchesQuery(p, q);
            if (mInfo.matched) {
                matches.push({ p: p, tier: mInfo.tier });
            }
        });
        matches.sort(function (a, b) {
            if (a.tier !== b.tier) return a.tier - b.tier;
            return _alnumNaturalCompare(a.p.name || a.p.sku, b.p.name || b.p.sku);
        });
        _pktF10DropdownMatches = matches.slice(0, 20).map(function (x) { return x.p; });
        _pktF10DropdownIdx = 0;
        _renderPktF10SearchDropdown();
    };

    global.pktF10PickSearchItem = function (elOrSku, skuArg) {
        var sku = typeof elOrSku === 'string' ? elOrSku : (skuArg || (elOrSku && elOrSku.getAttribute && elOrSku.getAttribute('data-click-arg')));
        if (!sku) return;
        var sourceList = _masterProducts.length ? _masterProducts : _allProducts;
        var found = sourceList.find(function (p) { return String(p.sku).toUpperCase() === String(sku).toUpperCase(); });
        if (!found) return;

        _pktF10SelectedCandidate = found;
        var inp = document.getElementById('pkt-f10-search-inp');
        var dd = document.getElementById('pkt-f10-search-dd');
        var chip = document.getElementById('pkt-f10-selected-chip');
        var qtyInp = document.getElementById('pkt-f10-add-qty');

        if (inp) inp.value = found.sku + ' — ' + (found.name || found.description || '');
        if (dd) dd.style.display = 'none';
        if (chip) {
            chip.textContent = found.sku;
            chip.style.display = 'inline-block';
        }
        if (qtyInp) {
            qtyInp.focus();
            try { qtyInp.select(); } catch (e) {}
        }
    };

    global.pktF10AddComponentBtn = function () {
        var inp = document.getElementById('pkt-f10-search-inp');
        var qtyInp = document.getElementById('pkt-f10-add-qty');
        var chip = document.getElementById('pkt-f10-selected-chip');
        var dd = document.getElementById('pkt-f10-search-dd');

        var prod = _pktF10SelectedCandidate;
        if (!prod && _pktF10DropdownMatches.length > 0) {
            prod = _pktF10DropdownMatches[_pktF10DropdownIdx] || _pktF10DropdownMatches[0];
        }
        if (!prod && inp && inp.value.trim()) {
            var q = inp.value.trim().toUpperCase();
            var sourceList = _masterProducts.length ? _masterProducts : _allProducts;
            prod = sourceList.find(function (p) {
                return !isPackageKit(p) && (String(p.sku).toUpperCase() === q || String(p.barcode || '').toUpperCase() === q);
            });
        }

        if (!prod) {
            toast('Busca y selecciona primero un producto del catálogo para agregarlo al paquete.', 'warning');
            if (inp) inp.focus();
            return;
        }

        var qty = parseFloat(qtyInp ? qtyInp.value : 1);
        if (isNaN(qty) || qty <= 0) qty = 1;

        var branchVal = (document.getElementById('pkt-f10-branch') || {}).value || 'TODAS';
        var scaleVal = (document.getElementById('pkt-f10-scale') || {}).value || 'PRECIO DE LISTA';

        var existing = _pktF10Components.find(function (c) {
            return String(c.sku).toUpperCase() === String(prod.sku).toUpperCase();
        });

        if (existing) {
            existing.qty = Math.round(((parseFloat(existing.qty) || 0) + qty) * 1000) / 1000;
        } else {
            _pktF10Components.push({
                product_id: prod.id || null,
                sku: prod.sku,
                name: prod.name || prod.description || prod.sku,
                sale_unit: prod.sale_unit || 'PIEZA',
                qty: qty,
                stock: getProductEffectiveStockForBranch(prod, branchVal === 'TODAS' ? 'MATRIZ' : branchVal),
                floor_cost_iva: _getComponentFloorCostIva(prod),
                unit_price_normal: _getComponentNormalPrice(prod, branchVal, scaleVal)
            });
        }

        _pktF10SelectedCandidate = null;
        _pktF10DropdownMatches = [];
        if (inp) inp.value = '';
        if (qtyInp) qtyInp.value = '1';
        if (chip) chip.style.display = 'none';
        if (dd) dd.style.display = 'none';

        _renderPktF10ComponentsTable();
        _recalcPktF10Financials('disc');
        if (inp) inp.focus();
    };

    global.pktF10UpdateItemQty = function (evOrEl) {
        var el = (evOrEl && evOrEl.target) ? evOrEl.target : evOrEl;
        if (!el) return;
        var idx = parseInt(el.getAttribute('data-idx'), 10);
        if (isNaN(idx) || !_pktF10Components[idx]) return;
        var newQty = parseFloat(el.value);
        if (isNaN(newQty) || newQty <= 0) return;
        _pktF10Components[idx].qty = newQty;
        _renderPktF10ComponentsTable();
        _recalcPktF10Financials('disc');
    };

    global.pktF10RemoveComponent = function (elOrIdx, idxArg) {
        var raw = typeof elOrIdx === 'number' || typeof elOrIdx === 'string'
            ? elOrIdx
            : (idxArg !== undefined ? idxArg : (elOrIdx && elOrIdx.getAttribute && elOrIdx.getAttribute('data-click-arg')));
        var idx = parseInt(raw, 10);
        if (isNaN(idx) || idx < 0 || idx >= _pktF10Components.length) return;
        _pktF10Components.splice(idx, 1);
        _renderPktF10ComponentsTable();
        _recalcPktF10Financials('disc');
    };

    global.pktF10SavePackage = async function () {
        var skuInp = document.getElementById('pkt-f10-sku');
        var nameInp = document.getElementById('pkt-f10-name');
        var typeSel = document.getElementById('pkt-f10-type');
        var branchSel = document.getElementById('pkt-f10-branch');
        var scaleSel = document.getElementById('pkt-f10-scale');
        var vigSel = document.getElementById('pkt-f10-vigencia');
        var dStart = document.getElementById('pkt-f10-date-start');
        var dEnd = document.getElementById('pkt-f10-date-end');
        var actSel = document.getElementById('pkt-f10-active');

        var sku = String((skuInp && skuInp.value) || '').trim().toUpperCase();
        var name = String((nameInp && nameInp.value) || '').trim().toUpperCase();
        if (!sku) {
            sku = _generateAutoPktSku();
            if (skuInp) skuInp.value = sku;
        }
        if (!name) {
            toast('Ingresa el Nombre del Paquete / Kit / Receta (ej. PAQUETE PREPARACIÓN CFE POSTE DE LUZ).', 'warning');
            if (nameInp) nameInp.focus();
            return;
        }
        if (!_pktF10Components.length) {
            toast('Agrega al menos 1 producto componente al paquete antes de guardar.', 'warning');
            var sInp = document.getElementById('pkt-f10-search-inp');
            if (sInp) sInp.focus();
            return;
        }

        var fin = _recalcPktF10Financials('disc');
        if (!fin.valid) {
            toast('Candado Financiero: Corrige el descuento o precio final (no puede ser menor al Costo Piso c/IVA).', 'error');
            return;
        }

        var vigType = (vigSel && vigSel.value) || 'PERMANENTE';
        var startDate = (dStart && dStart.value) || '';
        var endDate = (dEnd && dEnd.value) || '';
        if (vigType === 'FECHAS' && (!startDate || !endDate)) {
            toast('Selecciona la Fecha Inicio y Fecha Fin para la vigencia del paquete.', 'warning');
            return;
        }

        var factor = fin.sumNormal > 0 ? (fin.finalPrice / fin.sumNormal) : 1;
        var componentsPayload = _pktF10Components.map(function (c) {
            var q = parseFloat(c.qty) || 1;
            var uNormal = parseFloat(c.unit_price_normal) || 0;
            var uOffer = Math.round(uNormal * factor * 100) / 100;
            var uFloor = parseFloat(c.floor_cost_iva) || 0;
            if (uFloor > 0 && uOffer < uFloor) uOffer = uFloor;
            return {
                product_id: c.product_id || null,
                sku: c.sku,
                name: c.name,
                sale_unit: c.sale_unit || 'PIEZA',
                qty: q,
                floor_cost_iva: uFloor,
                unit_price_normal: uNormal,
                unit_price_package: uOffer,
                subtotal_normal: Math.round(q * uNormal * 100) / 100,
                subtotal_package: Math.round(q * uOffer * 100) / 100
            };
        });

        // Calcular cuántos paquetes completos se pueden armar según el stock actual de sus componentes
        var possibleKits = Infinity;
        _pktF10Components.forEach(function (c) {
            var q = parseFloat(c.qty) || 1;
            var st = parseFloat(c.stock) || 0;
            var kitsForComp = q > 0 ? Math.floor(st / q) : 0;
            if (kitsForComp < possibleKits) possibleKits = kitsForComp;
        });
        if (!isFinite(possibleKits) || possibleKits < 0) possibleKits = 0;

        var isAct = !actSel || actSel.value !== '0';
        var pkgConfig = {
            sku: sku,
            name: name,
            group_type: (typeSel && typeSel.value) || 'PAQUETE_VENTA',
            branch: (branchSel && branchSel.value) || 'TODAS',
            scale_name: (scaleSel && scaleSel.value) || 'PRECIO DE LISTA',
            vigencia_type: vigType,
            start_date: startDate,
            end_date: endDate,
            active: isAct,
            discount_pct: Math.round(fin.discPct * 100) / 100,
            sum_normal: fin.sumNormal,
            sum_floor_iva: fin.sumFloor,
            final_price: fin.finalPrice,
            zero_points: fin.discPct > 0.001,
            updated_at: new Date().toISOString(),
            components: componentsPayload
        };

        var existingProd = (_masterProducts.length ? _masterProducts : _allProducts).find(function (p) {
            return String(p.sku).toUpperCase() === sku;
        });

        var metaData = (existingProd && existingProd.meta_data && typeof existingProd.meta_data === 'object')
            ? JSON.parse(JSON.stringify(existingProd.meta_data))
            : {};
        metaData.is_package_kit = true;
        metaData.es_paquete = true;
        metaData.familia = metaData.familia || 'PAQUETES Y KITS';
        metaData.departamento = metaData.departamento || 'PAQUETES';
        metaData.marca = metaData.marca || 'CALEBSYS KIT';
        metaData.costo_con_flete = fin.sumFloor;
        metaData.costo_piso_iva = fin.sumFloor;
        metaData.iva = 0;
        metaData.activo = isAct;
        metaData.en_oferta = fin.discPct > 0.001;
        metaData.kardex = Object.assign({}, metaData.kardex || {}, {
            recetas: true,
            manejo_recetas_paquetes: true
        });
        metaData.package_config = pkgConfig;
        metaData.package_components = componentsPayload;

        var productRecord = {
            id: (existingProd && existingProd.id) ? existingProd.id : undefined,
            sku: sku,
            name: name,
            description: name,
            price: fin.finalPrice,
            average_cost: fin.sumFloor,
            tax_rate: 0,
            stock: possibleKits,
            sale_unit: 'PAQUETE',
            is_package_kit: true,
            en_oferta: fin.discPct > 0.001,
            meta_data: metaData
        };

        // Guardar en catálogo local de paquetes para disponibilidad instantánea
        var localList = _loadLocalPackagesCatalog().filter(function (x) {
            return String(x.sku).toUpperCase() !== sku;
        });
        localList.push(productRecord);
        _saveLocalPackagesCatalog(localList);

        // Intentar persistir también en la base de datos SQLite (/api/products)
        try {
            var method = (existingProd && existingProd.id) ? 'PUT' : 'POST';
            var endpoint = (existingProd && existingProd.id) ? ('/api/products/' + existingProd.id) : '/api/products';
            var resp = await fetch(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(productRecord)
            });
            if (resp.ok) {
                var savedBackend = await resp.json();
                if (savedBackend && savedBackend.sku) {
                    savedBackend.meta_data = Object.assign({}, savedBackend.meta_data || {}, metaData);
                    productRecord = savedBackend;
                    var updatedLocal = _loadLocalPackagesCatalog().filter(function (x) {
                        return String(x.sku).toUpperCase() !== sku;
                    });
                    updatedLocal.push(productRecord);
                    _saveLocalPackagesCatalog(updatedLocal);
                }
            }
        } catch (err) {
            console.warn('[CALEBSYS F10] Guardado local activo, sincronización backend:', err);
        }

        mergeIntoMasterProducts([productRecord]);
        _allProducts = _masterProducts;
        global._productsCache = _allProducts;

        _renderPktF10SavedPackagesList();
        applyClientFilters();

        try {
            global.dispatchEvent(new CustomEvent('calebsys:pos-pricing-updated', { detail: { sku: sku, is_package: true } }));
        } catch (e) {}

        toast('📦 Paquete [' + sku + '] "' + name + '" guardado y activado para Caja POS.', 'success');
        global.pktF10ResetForm();
    };

    global.pktF10EditSaved = function (elOrSku, skuArg) {
        var sku = typeof elOrSku === 'string' ? elOrSku : (skuArg || (elOrSku && elOrSku.getAttribute && elOrSku.getAttribute('data-click-arg')));
        if (!sku) return;
        var pkt = _getAllPackagesFromCatalog().find(function (p) {
            return String(p.sku).toUpperCase() === String(sku).toUpperCase();
        });
        if (!pkt) return;

        var m = (pkt.meta_data && typeof pkt.meta_data === 'object') ? pkt.meta_data : {};
        var cfg = m.package_config || {};
        var comps = Array.isArray(cfg.components) ? cfg.components : (Array.isArray(m.package_components) ? m.package_components : []);

        var editId = document.getElementById('pkt-f10-editing-id');
        var badge = document.getElementById('pkt-f10-edit-badge');
        var skuInp = document.getElementById('pkt-f10-sku');
        var nameInp = document.getElementById('pkt-f10-name');
        var typeSel = document.getElementById('pkt-f10-type');
        var branchSel = document.getElementById('pkt-f10-branch');
        var scaleSel = document.getElementById('pkt-f10-scale');
        var vigSel = document.getElementById('pkt-f10-vigencia');
        var dStart = document.getElementById('pkt-f10-date-start');
        var dEnd = document.getElementById('pkt-f10-date-end');
        var actSel = document.getElementById('pkt-f10-active');
        var discInp = document.getElementById('pkt-f10-disc-pct');
        var finalInp = document.getElementById('pkt-f10-final-price');

        if (editId) editId.value = pkt.sku;
        if (badge) badge.style.display = 'inline-block';
        if (skuInp) skuInp.value = pkt.sku;
        if (nameInp) nameInp.value = pkt.name || pkt.description || '';
        if (typeSel) typeSel.value = cfg.group_type || 'PAQUETE_VENTA';
        if (branchSel && cfg.branch) branchSel.value = cfg.branch;
        if (scaleSel && cfg.scale_name) scaleSel.value = cfg.scale_name;
        if (vigSel) vigSel.value = cfg.vigencia_type || 'PERMANENTE';
        if (dStart) dStart.value = cfg.start_date || '';
        if (dEnd) dEnd.value = cfg.end_date || '';
        if (actSel) actSel.value = (cfg.active === false || pkt.activo === false) ? '0' : '1';
        if (discInp) discInp.value = (parseFloat(cfg.discount_pct || 0) || 0).toFixed(2);
        if (finalInp) finalInp.value = (parseFloat(pkt.price || cfg.final_price || 0) || 0).toFixed(2);

        _pktF10Components = comps.map(function (c) {
            return {
                product_id: c.product_id || null,
                sku: c.sku,
                name: c.name || c.sku,
                sale_unit: c.sale_unit || 'PIEZA',
                qty: parseFloat(c.qty) || 1,
                stock: parseFloat(c.stock) || 0,
                floor_cost_iva: parseFloat(c.floor_cost_iva) || 0,
                unit_price_normal: parseFloat(c.unit_price_normal) || 0
            };
        });

        global.pktF10OnVigenciaChange();
        _renderPktF10ComponentsTable();
        _recalcPktF10Financials('disc');
    };

    global.pktF10ToggleActiveSaved = async function (elOrSku, skuArg) {
        var sku = typeof elOrSku === 'string' ? elOrSku : (skuArg || (elOrSku && elOrSku.getAttribute && elOrSku.getAttribute('data-click-arg')));
        if (!sku) return;
        var pkt = _getAllPackagesFromCatalog().find(function (p) {
            return String(p.sku).toUpperCase() === String(sku).toUpperCase();
        });
        if (!pkt) return;

        var m = (pkt.meta_data && typeof pkt.meta_data === 'object') ? pkt.meta_data : {};
        var cfg = m.package_config || {};
        var newActive = !(isActive(pkt) && cfg.active !== false);
        cfg.active = newActive;
        m.activo = newActive;
        pkt.activo = newActive;
        pkt.meta_data = m;

        var localList = _loadLocalPackagesCatalog().filter(function (x) {
            return String(x.sku).toUpperCase() !== String(sku).toUpperCase();
        });
        localList.push(pkt);
        _saveLocalPackagesCatalog(localList);

        if (pkt.id) {
            try {
                await fetch('/api/products/' + pkt.id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(pkt)
                });
            } catch (e) {}
        }

        _renderPktF10SavedPackagesList();
        applyClientFilters();
        toast(newActive ? ('🟢 Paquete [' + sku + '] activado.') : ('⏸️ Paquete [' + sku + '] pausado.'), 'info');
    };

    global.pktF10DeleteSaved = async function (elOrSku, skuArg) {
        var sku = typeof elOrSku === 'string' ? elOrSku : (skuArg || (elOrSku && elOrSku.getAttribute && elOrSku.getAttribute('data-click-arg')));
        if (!sku) return;
        if (!window.confirm('¿Eliminar el paquete [' + sku + '] del catálogo? (Sus productos componentes individuales NO se borrarán)')) return;

        var pkt = _getAllPackagesFromCatalog().find(function (p) {
            return String(p.sku).toUpperCase() === String(sku).toUpperCase();
        });

        var localList = _loadLocalPackagesCatalog().filter(function (x) {
            return String(x.sku).toUpperCase() !== String(sku).toUpperCase();
        });
        _saveLocalPackagesCatalog(localList);

        _masterProducts = _masterProducts.filter(function (p) { return String(p.sku).toUpperCase() !== String(sku).toUpperCase(); });
        _allProducts = _masterProducts;
        global._productsCache = _allProducts;

        if (pkt && pkt.id) {
            try {
                await fetch('/api/products/' + pkt.id, { method: 'DELETE', credentials: 'include' });
            } catch (e) {}
        }

        _renderPktF10SavedPackagesList();
        applyClientFilters();
        toast('🗑️ Paquete [' + sku + '] eliminado.', 'info');
    };

    global.pktF10FilterCatalog = function () {
        var estSel = document.getElementById('pc-f-estado');
        if (estSel) {
            estSel.value = estSel.value === 'paquetes' ? '' : 'paquetes';
        }
        _closeModalById('modal-paquetes-f10');
        applyClientFilters();
        keepSearchInputFocused(true);
    };

    // ========================================================================
    // MÓDULO: ⚡ PRODUCTO EXPRESS [F1] — ALTA RÁPIDA + MOTOR OCULTO DEL ERP
    // ========================================================================
    var _expF1Mode = 'PIEZA'; // 'PIEZA' (H87) o 'GRANEL' (KGM / Pesado)
    var _expF1Saving = false;
    var _expF1LoadedExistingSku = '';

    var _EXPRESS_SAT_RULES = [
        { rx: /\b(CEMENTO|MORTERO|PEGAZULEJO|BOQUILLA|ESTUCO)\b/i, sat: '30111601' },
        { rx: /\b(CAL|YESO)\b/i, sat: '30111600' },
        { rx: /\b(ARENA|GRAVA|TEZONTLE|PIEDRA)\b/i, sat: '11111600' },
        { rx: /\b(BLOCK|LADRILLO|TABIQUE|TABICON|BOVEDILLA|ADOQUIN)\b/i, sat: '30131500' },
        { rx: /\b(VARILLA|CASTILLO|ARMEX|MALLA\s*ELECTROSOLDADA)\b/i, sat: '30101615' },
        { rx: /\b(ALAMBRE|ALAMBRON)\b/i, sat: '30103600' },
        { rx: /\b(CLAVO|GRAPA)\b/i, sat: '31162000' },
        { rx: /\b(TORNILLO|PIJA|TUERCA|RONDANA|ARANDELA|TAQUETE|BIRLO|ESPÁRRAGO|ESPARRAGO)\b/i, sat: '31161500' },
        { rx: /\b(MARTILLO|MARRO|MAZO)\b/i, sat: '27111602' },
        { rx: /\b(DESARMADOR|DESTORNILLADOR|PUNTA)\b/i, sat: '27111701' },
        { rx: /\b(PINZA|ALICATE|TENAZA|CIZALLA)\b/i, sat: '27112100' },
        { rx: /\b(LLAVE\s*MIXTA|LLAVE\s*ESPAÑOLA|LLAVE\s*STILSON|PERICO|MATRACA|DADO)\b/i, sat: '27111700' },
        { rx: /\b(FLEXOMETRO|FLEXÓMETRO|CINTA\s*METRICA|NIVEL|ESCUADRA)\b/i, sat: '27111801' },
        { rx: /\b(DISCO\s*CORTE|DISCO\s*SIERRA|DISCO\s*DIAMANTE|DISCO\s*DESBASTE|SEGUETA)\b/i, sat: '27112800' },
        { rx: /\b(TALADRO|ROTOMARTILLO|ESMERIL|ESMERILADORA|SIERRA|LIJADORA|PULIDORA)\b/i, sat: '27112700' },
        { rx: /\b(PALA|PICO|AZADON|CARRETILLA|RASTRILLO|CAVADOR)\b/i, sat: '27112000' },
        { rx: /\b(TUBO|TUBERIA|TUBERÍA|CPVC|PVC|PPR|GALVANIZADO|COBRE)\b/i, sat: '40141700' },
        { rx: /\b(CODO|TEE|COPLE|CONECTOR|REDUCCION|TUERCA\s*UNION|NIPLE|YEE)\b/i, sat: '40142300' },
        { rx: /\b(VALVULA|VÁLVULA|LLAVE\s*DE\s*PASO|LLAVE\s*JARDIN|MEZCLADORA|MONOMANDO|REGADERA|CESPOL|FLOTADOR)\b/i, sat: '40141600' },
        { rx: /\b(TINACO|CISTERNA)\b/i, sat: '24111800' },
        { rx: /\b(BOMBA\s*AGUA|BOMBA\s*PERIFERICA|BOMBA\s*CENTRIFUGA|HIDRONEUMATICO)\b/i, sat: '40151500' },
        { rx: /\b(PINTURA|ESMALTE|VINILICA|VINÍLICA|ACRILICA|AEROSOL|BARNIZ)\b/i, sat: '31211500' },
        { rx: /\b(IMPERMEABILIZANTE|SELLADOR|RESANADOR)\b/i, sat: '31201600' },
        { rx: /\b(THINNER|AGUARRAS|AGUARRÁS|SOLVENTE|ACETONA|ACIDO|ÁCIDO)\b/i, sat: '12191601' },
        { rx: /\b(BROCHA|RODILLO|CHAROLA|ESPATULA|ESPÁTULA|LLANA)\b/i, sat: '31211900' },
        { rx: /\b(SILICON|SILICÓN|PEGAMENTO|ADHESIVO|EPOXICO|CINTA\s*AISLAR|CINTA\s*TEFLON|TEFLÓN)\b/i, sat: '31201610' },
        { rx: /\b(LIJA|ABRASIVO)\b/i, sat: '31191500' },
        { rx: /\b(CABLE|CORDON\s*ELECTRICO|EXTENSION|EXTENSIÓN)\b/i, sat: '26121600' },
        { rx: /\b(FOCO|LAMPARA|LÁMPARA|REFLECTOR|LED)\b/i, sat: '39101600' },
        { rx: /\b(CONTACTO|APAGADOR|CLAVIJA|SOCKET|PORTALAMPARA|PASTILLA|INTERRUPTOR|CENTRO\s*DE\s*CARGA|CHALUPA|POLIDUCTO)\b/i, sat: '39121400' },
        { rx: /\b(MADERA|TRIPLAY|POLIN|POLÍN|BARROTE|TABLA|TABLON|MDF|CIMBRA)\b/i, sat: '30103605' },
        { rx: /\b(CANDADO|CERRADURA|CHAPA|BISAGRA|PASADOR|CERROJO)\b/i, sat: '46171500' },
        { rx: /\b(GUANTE|CASCO|LENTE|GAFA|CHALECO|BOTA|IMPERMEABLE|CARETA|ARNES)\b/i, sat: '46181500' },
        { rx: /\b(REFRESCO|SODA|GASEOSA|COCA|PEPSI)\b/i, sat: '50202306' },
        { rx: /\b(AGUA\s*EMBOTELLADA|AGUA\s*PURIFICADA|GARRAFON|AGUA)\b/i, sat: '50202301' },
        { rx: /\b(ESCOBA|TRAPEADOR|JALADOR|CUBETA|RECOGEDOR|DETERGENTE|CLORO|JABON)\b/i, sat: '47131600' }
    ];

    function _detectExpressSatCode(description) {
        var desc = String(description || '').trim().toUpperCase();
        if (!desc) return '01010101';

        for (var i = 0; i < _EXPRESS_SAT_RULES.length; i++) {
            if (_EXPRESS_SAT_RULES[i].rx.test(desc)) {
                return _EXPRESS_SAT_RULES[i].sat;
            }
        }

        // Buscar coincidencia semántica en el catálogo actual si comparten primera palabra clave
        var firstWord = (desc.split(/\s+/)[0] || '').replace(/[^A-Z0-9ÁÉÍÓÚÑ]/g, '');
        if (firstWord.length >= 4 && Array.isArray(_masterProducts)) {
            for (var j = 0; j < _masterProducts.length; j++) {
                var p = _masterProducts[j];
                if (!p || !p.sat_id || p.sat_id === '01010101') continue;
                var pName = String(p.name || p.description || '').toUpperCase();
                if (pName.indexOf(firstWord) === 0 || pName.indexOf(' ' + firstWord) !== -1) {
                    return String(p.sat_id);
                }
            }
        }

        return '01010101';
    }

    function _inferExpressLogisticsF4(description, isGranel) {
        var d = String(description || '').toUpperCase();
        var pesoKg = isGranel ? 1.000 : 0.850;
        var largoCm = 22;
        var anchoCm = 15;
        var altoCm = 10;
        var pzsTarima = 120;
        var estibaMax = 6;
        var fraccion = '7326.90.99';
        var embalaje = '4G';
        var matPeligroso = false;
        var cveMatPeligroso = '';
        var clasePeligro = '';
        var grupoEmbalaje = '';

        var kgMatch = d.match(/(\d+(?:\.\d+)?)\s*(?:KG|KILOS|KILOGRAMOS)\b/);
        var ltMatch = d.match(/(\d+(?:\.\d+)?)\s*(?:LT|LTS|LITRO|LITROS|L)\b/);
        var galMatch = d.match(/(\d+(?:\.\d+)?)\s*(?:GAL|GALON|GALONES)\b/);

        if (/\b(CEMENTO|MORTERO|CAL|YESO|PEGAZULEJO)\b/.test(d)) {
            pesoKg = kgMatch ? parseFloat(kgMatch[1]) : 50.000;
            largoCm = 62; anchoCm = 42; altoCm = 13;
            pzsTarima = 40; estibaMax = 8;
            fraccion = '2523.29.99'; embalaje = '5M';
        } else if (/\b(BLOCK|LADRILLO|TABIQUE|TABICON)\b/.test(d)) {
            pesoKg = kgMatch ? parseFloat(kgMatch[1]) : 12.500;
            largoCm = 40; anchoCm = 15; altoCm = 20;
            pzsTarima = 120; estibaMax = 5;
            fraccion = '6810.11.01'; embalaje = 'Z1';
        } else if (/\b(VARILLA|TUBO|PERFIL|PTR|POLIN)\b/.test(d)) {
            pesoKg = kgMatch ? parseFloat(kgMatch[1]) : 6.500;
            largoCm = 600; anchoCm = 5; altoCm = 5;
            pzsTarima = 200; estibaMax = 4;
            fraccion = '7214.20.02'; embalaje = 'Z1';
        } else if (/\b(PINTURA|IMPERMEABILIZANTE|SELLADOR|ESMALTE|BARNIZ)\b/.test(d)) {
            var litros = ltMatch ? parseFloat(ltMatch[1]) : (galMatch ? parseFloat(galMatch[1]) * 3.785 : 4.0);
            pesoKg = Number((litros * 1.32).toFixed(3));
            largoCm = litros >= 18 ? 30 : 20;
            anchoCm = litros >= 18 ? 30 : 20;
            altoCm = litros >= 18 ? 38 : 24;
            pzsTarima = litros >= 18 ? 36 : 80;
            estibaMax = 4;
            fraccion = '3209.10.99'; embalaje = '1A2';
        } else if (/\b(THINNER|AGUARRAS|AGUARRÁS|SOLVENTE|ACETONA|ACIDO|ÁCIDO|GAS)\b/.test(d)) {
            var ltsHaz = ltMatch ? parseFloat(ltMatch[1]) : 1.0;
            pesoKg = Number((ltsHaz * 0.92).toFixed(3));
            largoCm = 12; anchoCm = 12; altoCm = 26;
            pzsTarima = 100; estibaMax = 3;
            fraccion = '3814.00.01'; embalaje = '4G';
            matPeligroso = true;
            cveMatPeligroso = 'UN1263';
            clasePeligro = '3 - Líquidos inflamables';
            grupoEmbalaje = 'III - Peligrosidad baja';
        } else if (kgMatch) {
            pesoKg = parseFloat(kgMatch[1]) || 1.000;
        } else if (ltMatch) {
            pesoKg = parseFloat(ltMatch[1]) || 1.000;
        }

        var volM3 = Number(((largoCm * anchoCm * altoCm) / 1000000).toFixed(6));

        return {
            peso_kg: Number(pesoKg.toFixed(3)),
            largo_cm: largoCm,
            ancho_cm: anchoCm,
            alto_cm: altoCm,
            volumen_m3: volM3,
            pzs_tarima: pzsTarima,
            estiba_max: estibaMax,
            fraccion_arancelaria: fraccion,
            tipo_embalaje: embalaje,
            mat_peligroso: matPeligroso,
            cve_mat_peligroso: cveMatPeligroso,
            clase_peligro: clasePeligro,
            grupo_embalaje: grupoEmbalaje,
            auto_calculated: true
        };
    }

    function _updateExpressFloorAlert(costo, precioFinal) {
        var alertEl = document.getElementById('exp-floor-alert');
        if (!alertEl) return true;
        var c = parseFloat(costo) || 0;
        var p = parseFloat(precioFinal) || 0;
        if (c > 0 && p > 0 && p < c) {
            alertEl.style.display = 'block';
            alertEl.textContent = '🛡️ Candado Anti-Pérdida: El Precio Final ($' + p.toFixed(2) + ') no puede ser menor al Precio de Costo ($' + c.toFixed(2) + ').';
            return false;
        }
        alertEl.style.display = 'none';
        alertEl.textContent = '';
        return true;
    }

    function _resetExpressFormFields(keepModeAndRafaga) {
        var codInp = document.getElementById('exp-codigo');
        var nomInp = document.getElementById('exp-nombre');
        var cosInp = document.getElementById('exp-costo');
        var utiInp = document.getElementById('exp-utilidad');
        var prcInp = document.getElementById('exp-precio-final');
        var alertEl = document.getElementById('exp-floor-alert');
        var chkRaf = document.getElementById('exp-chk-rafaga');

        _expF1LoadedExistingSku = '';
        if (codInp) codInp.value = '';
        if (nomInp) nomInp.value = '';
        if (cosInp) cosInp.value = '';
        if (utiInp) utiInp.value = '';
        if (prcInp) prcInp.value = '';
        if (alertEl) {
            alertEl.style.display = 'none';
            alertEl.textContent = '';
        }

        if (!keepModeAndRafaga) {
            if (chkRaf) chkRaf.checked = true;
            global.expF1SelectMode('PIEZA', true);
        }
    }

    function _lookupExistingExpressProduct(rawCode) {
        var c = String(rawCode || '').trim().toUpperCase();
        if (!c) return null;
        var cNoZeros = c.replace(/^0+/, '');
        var list = (_masterProducts && _masterProducts.length) ? _masterProducts : (_allProducts || []);
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (!p) continue;
            var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
            var sku = String(p.sku || '').trim().toUpperCase();
            var bc = String(p.barcode || m.codigo_barras || '').trim().toUpperCase();
            var sc = String(p.sales_code || m.codigo_ventas || '').trim().toUpperCase();
            var bcNoZeros = bc.replace(/^0+/, '');
            if (sku === c || (bc && (bc === c || (cNoZeros && bcNoZeros === cNoZeros))) || (sc && sc === c)) {
                return p;
            }
        }
        return null;
    }

    function _applyExistingExpressProductToForm(rawCode) {
        var code = String(rawCode || '').trim().toUpperCase();
        var nomInp = document.getElementById('exp-nombre');
        var cosInp = document.getElementById('exp-costo');
        var utiInp = document.getElementById('exp-utilidad');
        var prcInp = document.getElementById('exp-precio-final');

        var found = _lookupExistingExpressProduct(code);
        if (found) {
            _expF1LoadedExistingSku = String(found.sku || code).toUpperCase();
            var m = (found.meta_data && typeof found.meta_data === 'object') ? found.meta_data : {};
            var isGranelProd = Boolean(
                m.art_pesado ||
                String(found.sat_unidad || m.sat_unidad || '').toUpperCase() === 'KGM' ||
                String(found.sale_unit || m.unidad_venta || '').toUpperCase() === 'KILOGRAMO'
            );
            global.expF1SelectMode(isGranelProd ? 'GRANEL' : 'PIEZA', true);

            var prodName = String(found.name || found.description || '').trim().toUpperCase();
            var prodCost = getCosto(found);
            if (!(prodCost > 0)) prodCost = parseFloat(found.average_cost || m.costo_raw || 0) || 0;
            var prodPrice = getPrice(found);
            if (!(prodPrice > 0)) prodPrice = parseFloat(found.price || m.precio_final_pieza || 0) || 0;
            var prodUtil = 0;
            if (prodCost > 0 && prodPrice > 0) {
                prodUtil = ((prodPrice / prodCost) - 1) * 100;
            } else {
                prodUtil = getMarginPct(found) || 0;
            }

            if (nomInp) nomInp.value = prodName;
            if (cosInp) cosInp.value = prodCost > 0 ? prodCost.toFixed(2) : '0.00';
            if (utiInp) utiInp.value = prodUtil ? Number(prodUtil.toFixed(2)) : '0';
            if (prcInp) prcInp.value = prodPrice > 0 ? prodPrice.toFixed(2) : '';
            _updateExpressFloorAlert(prodCost, prodPrice);
            return found;
        } else if (_expF1LoadedExistingSku) {
            // Si antes había cargado un producto existente y el usuario cambió/borró el código, limpiar campos rellenados
            _expF1LoadedExistingSku = '';
            if (nomInp) nomInp.value = '';
            if (cosInp) cosInp.value = '';
            if (utiInp) utiInp.value = '';
            if (prcInp) prcInp.value = '';
            _updateExpressFloorAlert(0, 0);
        }
        return null;
    }

    global.expF1CloseModal = function () {
        var m = document.getElementById('modal-producto-express-f1');
        if (m && document.activeElement && m.contains(document.activeElement)) {
            try { document.activeElement.blur(); } catch (e) {}
        }
        _closeModalById('modal-producto-express-f1');
        keepSearchInputFocused(true);
    };

    global.productsOpenExpressF1 = function () {
        var m = document.getElementById('modal-producto-express-f1');
        if (!m) return;
        _resetExpressFormFields(false);
        m.classList.add('open');
        setTimeout(function () {
            var codInp = document.getElementById('exp-codigo');
            if (codInp) {
                codInp.focus();
            }
        }, 40);
    };

    global.expF1OnCodeInput = function (el) {
        var inp = (el && el.tagName === 'INPUT') ? el : document.getElementById('exp-codigo');
        if (!inp) return;
        var start = inp.selectionStart;
        var end = inp.selectionEnd;
        var upper = String(inp.value || '').toUpperCase();
        if (inp.value !== upper) {
            inp.value = upper;
            try { inp.setSelectionRange(start, end); } catch (e) {}
        }
        _applyExistingExpressProductToForm(upper);
    };

    global.expF1SelectMode = function (elOrMode, skipFocus) {
        var mode = typeof elOrMode === 'string'
            ? elOrMode
            : ((elOrMode && elOrMode.getAttribute && elOrMode.getAttribute('data-click-arg')) || 'PIEZA');
        _expF1Mode = (String(mode).toUpperCase() === 'GRANEL') ? 'GRANEL' : 'PIEZA';

        var btnPieza = document.getElementById('exp-mode-pieza');
        var btnGranel = document.getElementById('exp-mode-granel');
        if (btnPieza && btnGranel) {
            if (_expF1Mode === 'PIEZA') {
                btnPieza.style.border = '1.5px solid var(--brand-400)';
                btnPieza.style.background = 'rgba(59,130,246,.12)';
                btnPieza.style.color = 'var(--brand-400)';
                btnPieza.style.fontWeight = '800';

                btnGranel.style.border = '1px solid transparent';
                btnGranel.style.background = 'transparent';
                btnGranel.style.color = 'var(--text-secondary)';
                btnGranel.style.fontWeight = '700';
            } else {
                btnGranel.style.border = '1.5px solid var(--brand-400)';
                btnGranel.style.background = 'rgba(59,130,246,.12)';
                btnGranel.style.color = 'var(--brand-400)';
                btnGranel.style.fontWeight = '800';

                btnPieza.style.border = '1px solid transparent';
                btnPieza.style.background = 'transparent';
                btnPieza.style.color = 'var(--text-secondary)';
                btnPieza.style.fontWeight = '700';
            }
        }

        if (!skipFocus) {
            var codInp = document.getElementById('exp-codigo');
            var nomInp = document.getElementById('exp-nombre');
            if (codInp && !String(codInp.value || '').trim()) {
                codInp.focus();
            } else if (nomInp) {
                nomInp.focus();
            }
        }
    };

    global.expF1GenerateCode = function () {
        var usedSkus = new Set();
        (_masterProducts || []).forEach(function (p) {
            if (p && p.sku) usedSkus.add(String(p.sku).trim().toUpperCase());
            if (p && p.barcode) usedSkus.add(String(p.barcode).trim().toUpperCase());
        });

        var seq = 1;
        var candidate = '';
        while (seq < 99999) {
            candidate = 'EXP-' + String(seq).padStart(4, '0');
            if (!usedSkus.has(candidate)) break;
            seq++;
        }

        _expF1LoadedExistingSku = '';
        var codInp = document.getElementById('exp-codigo');
        var nomInp = document.getElementById('exp-nombre');
        var cosInp = document.getElementById('exp-costo');
        var utiInp = document.getElementById('exp-utilidad');
        var prcInp = document.getElementById('exp-precio-final');
        if (codInp) codInp.value = candidate;
        if (nomInp) nomInp.value = '';
        if (cosInp) cosInp.value = '';
        if (utiInp) utiInp.value = '';
        if (prcInp) prcInp.value = '';

        if (nomInp) {
            nomInp.focus();
            nomInp.select();
        }
    };

    global.expF1OnNameInput = function (el) {
        var inp = (el && el.tagName === 'INPUT') ? el : document.getElementById('exp-nombre');
        if (!inp) return;
        var start = inp.selectionStart;
        var end = inp.selectionEnd;
        var upper = String(inp.value || '').toUpperCase();
        if (inp.value !== upper) {
            inp.value = upper;
            try { inp.setSelectionRange(start, end); } catch (e) {}
        }
    };

    global.expF1OnCostInput = function () {
        var cosInp = document.getElementById('exp-costo');
        var utiInp = document.getElementById('exp-utilidad');
        var prcInp = document.getElementById('exp-precio-final');
        if (!cosInp || !utiInp || !prcInp) return;

        var costo = parseFloat(cosInp.value);
        var util = parseFloat(utiInp.value);
        if (isNaN(costo) || costo < 0) {
            _updateExpressFloorAlert(0, 0);
            return;
        }
        if (isNaN(util)) util = 0;

        var finalPrice = costo * (1 + (util / 100));
        prcInp.value = finalPrice > 0 ? finalPrice.toFixed(2) : (costo === 0 ? '0.00' : '');
        _updateExpressFloorAlert(costo, finalPrice);
    };

    global.expF1OnUtilInput = function () {
        var cosInp = document.getElementById('exp-costo');
        var utiInp = document.getElementById('exp-utilidad');
        var prcInp = document.getElementById('exp-precio-final');
        if (!cosInp || !utiInp || !prcInp) return;

        var costo = parseFloat(cosInp.value);
        var util = parseFloat(utiInp.value);
        if (isNaN(costo) || costo <= 0) return;
        if (isNaN(util)) util = 0;

        var finalPrice = costo * (1 + (util / 100));
        prcInp.value = Math.max(0, finalPrice).toFixed(2);
        _updateExpressFloorAlert(costo, finalPrice);
    };

    global.expF1OnPriceInput = function () {
        var cosInp = document.getElementById('exp-costo');
        var utiInp = document.getElementById('exp-utilidad');
        var prcInp = document.getElementById('exp-precio-final');
        if (!cosInp || !utiInp || !prcInp) return;

        var costo = parseFloat(cosInp.value);
        var finalPrice = parseFloat(prcInp.value);
        if (isNaN(finalPrice) || finalPrice < 0) return;

        if (!isNaN(costo) && costo > 0) {
            var utilBack = ((finalPrice / costo) - 1) * 100;
            utiInp.value = utilBack.toFixed(2);
        }
        _updateExpressFloorAlert(costo, finalPrice);
    };

    function _persistExpressProductToLocalCustomCache(prodRecord) {
        try {
            var raw = global.localStorage ? global.localStorage.getItem('calebsys_producto_alta_custom_v2') : null;
            var arr = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(arr)) arr = [];
            var skuKey = String(prodRecord.sku || '').trim().toUpperCase();
            arr = arr.filter(function (x) {
                return String((x && x.sku) || '').trim().toUpperCase() !== skuKey;
            });
            arr.unshift(prodRecord);
            if (global.localStorage) {
                global.localStorage.setItem('calebsys_producto_alta_custom_v2', JSON.stringify(arr));
            }
        } catch (e) {}
    }

    global.expF1SaveProduct = async function () {
        if (_expF1Saving) return;

        var codInp = document.getElementById('exp-codigo');
        var nomInp = document.getElementById('exp-nombre');
        var cosInp = document.getElementById('exp-costo');
        var utiInp = document.getElementById('exp-utilidad');
        var prcInp = document.getElementById('exp-precio-final');
        var chkRaf = document.getElementById('exp-chk-rafaga');

        var code = String((codInp && codInp.value) || '').trim().toUpperCase();
        var name = String((nomInp && nomInp.value) || '').trim().toUpperCase();
        var costo = parseFloat(cosInp && cosInp.value);
        var utilPct = parseFloat(utiInp && utiInp.value);
        var precioFinal = parseFloat(prcInp && prcInp.value);

        if (!code) {
            toast('⚠️ Escanea o escribe el Código, o usa "⚡ Sin Código (Generar)".', 'warning');
            if (codInp) codInp.focus();
            return;
        }
        if (!name) {
            toast('⚠️ Ingresa el Nombre / Descripción del Producto.', 'warning');
            if (nomInp) nomInp.focus();
            return;
        }
        if (isNaN(costo) || costo < 0) {
            costo = 0;
        }
        if ((isNaN(precioFinal) || precioFinal <= 0) && costo > 0) {
            var u = isNaN(utilPct) ? 30 : utilPct;
            precioFinal = Number((costo * (1 + (u / 100))).toFixed(2));
            if (prcInp) prcInp.value = precioFinal.toFixed(2);
        }
        if (isNaN(precioFinal) || precioFinal <= 0) {
            toast('⚠️ Ingresa el Precio Final ($) del producto.', 'warning');
            if (prcInp) prcInp.focus();
            return;
        }
        if (!_updateExpressFloorAlert(costo, precioFinal)) {
            toast('🛡️ El Precio Final no puede ser menor al Precio de Costo.', 'error');
            if (prcInp) { prcInp.focus(); prcInp.select(); }
            return;
        }

        if (costo > 0) {
            utilPct = Number((((precioFinal / costo) - 1) * 100).toFixed(2));
        } else if (isNaN(utilPct)) {
            utilPct = 100;
        }

        // Verificar si ya existe un producto con ese mismo SKU o Código de Barras para actualizarlo o crear uno nuevo
        var existingProd = _lookupExistingExpressProduct(code);
        var effectiveSku = (existingProd && existingProd.sku) ? String(existingProd.sku).trim().toUpperCase() : code;
        var keepAdding = chkRaf ? Boolean(chkRaf.checked) : true;

        // Limpiar de inmediato la pantalla del modal si está en Modo Ráfaga para dejarla lista para el siguiente producto
        if (keepAdding) {
            _resetExpressFormFields(true);
            var codImmediate = document.getElementById('exp-codigo');
            if (codImmediate) {
                codImmediate.focus();
            }
        } else {
            global.expF1CloseModal();
        }

        // Motor Oculto del ERP:
        // 1. Unidades y SAT según selector Pieza (H87) o A Granel / Kilo (KGM + Artículo Pesado)
        var isGranel = (_expF1Mode === 'GRANEL');
        var satUnidad = isGranel ? 'KGM' : 'H87';
        var unitName = isGranel ? 'KILOGRAMO' : 'PIEZA';
        var satId = (existingProd && existingProd.sat_id && existingProd.sat_id !== '01010101')
            ? existingProd.sat_id
            : _detectExpressSatCode(name);

        // 2. Desglose inteligente de IVA 16% y Costo Piso Intocable para compatibilidad total con #producto-alta y POS
        var ivaPct = 16;
        var costoPisoIva = Number(costo.toFixed(2));
        var margenSinIva = utilPct;
        if (costo > 0) {
            var precioSinIva = precioFinal / (1 + (ivaPct / 100));
            if (precioSinIva >= costo) {
                margenSinIva = Number((((precioSinIva / costo) - 1) * 100).toFixed(4));
            } else {
                margenSinIva = Number(utilPct.toFixed(4));
            }
        }

        // 3. Escalas de Precio (PRECIO DE LISTA en Matriz y Sucursales)
        var scaleListaRow = {
            escala: 'PRECIO DE LISTA',
            name: 'PRECIO DE LISTA',
            margen_ideal: Number(utilPct.toFixed(2)),
            margen_trabajo: Number(utilPct.toFixed(2)),
            margen_final: Number(utilPct.toFixed(2)),
            utilidad_pesos: Number(Math.max(0, precioFinal - costo).toFixed(2)),
            precio: Number(precioFinal.toFixed(2)),
            price: Number(precioFinal.toFixed(2)),
            precio_activo: Number(precioFinal.toFixed(2)),
            activa: true
        };
        var priceScales = [scaleListaRow];
        var branchPriceScales = {
            'MATRIZ': [Object.assign({}, scaleListaRow)],
            'SUCURSAL 1': [Object.assign({}, scaleListaRow)],
            'SUCURSAL 2': [Object.assign({}, scaleListaRow)],
            'SUCURSAL 3': [Object.assign({}, scaleListaRow)]
        };

        // 4. Inferencia silenciosa de Logística y Carta Porte 3.1 (Complementos [F4])
        var existingMeta = (existingProd && existingProd.meta_data && typeof existingProd.meta_data === 'object') ? existingProd.meta_data : {};
        var logisticsF4 = (existingMeta.complements_f4 && existingMeta.complements_f4.logistics)
            ? existingMeta.complements_f4.logistics
            : _inferExpressLogisticsF4(name, isGranel);
        var nowIso = new Date().toISOString();

        var famVal = (existingProd && existingProd.familia) || existingMeta.familia || 'GENERAL';
        var depVal = (existingProd && existingProd.departamento) || existingMeta.departamento || 'GENERAL';
        var marVal = (existingProd && existingProd.marca) || existingMeta.marca || 'GENÉRICO';

        var metaData = Object.assign({}, existingMeta, {
            codigo_barras: (existingProd && existingProd.barcode) ? existingProd.barcode : code,
            codigo_ventas: (existingProd && existingProd.sales_code) ? existingProd.sales_code : code,
            sat_id: satId,
            sat_unidad: satUnidad,
            familia: famVal,
            departamento: depVal,
            marca: marVal,
            unidad_compra: unitName,
            unidad_venta: unitName,
            piezas_por_caja: 1,
            costo_raw: Number(costo.toFixed(2)),
            costo_pieza: Number(costo.toFixed(2)),
            flete_pct: 0,
            flete_monto: 0,
            costo_con_flete: Number(costo.toFixed(2)),
            costo_piso_iva: costoPisoIva,
            margen: margenSinIva,
            margen_final_pieza: Number(utilPct.toFixed(2)),
            sobreprecio_pieza_pct: 0,
            iva: ivaPct,
            ieps: 0,
            precio_caja: Number(precioFinal.toFixed(2)),
            precio_final_pieza: Number(precioFinal.toFixed(2)),
            precio_final_caja: Number(precioFinal.toFixed(2)),
            is_active: true,
            activo: true,
            art_pesado: isGranel,
            precio_abierto: false,
            art_negativo: true,
            desact_venta: false,
            desact_compras: false,
            desact_traspasos: false,
            kardex: Object.assign({
                auditoria: false,
                servicio: false,
                no_desc: false,
                no_ofertas_cal: false,
                no_ofertas_depto: false,
                corte_z: false,
                no_variantes: false,
                base_prod: false,
                ofertas_cruzadas: true,
                recarga_celular: false,
                antibiotico: false,
                exento_iva: false,
                desc_abierta: false,
                prod_controlado: false,
                existencia_neg: true,
                autorizacion: false,
                no_inventariable: false,
                recetas_paquetes: false
            }, existingMeta.kardex || {}),
            price_scales: priceScales,
            branch_price_scales: branchPriceScales,
            price_history: [
                {
                    fecha: new Date().toLocaleString('es-MX'),
                    costo_anterior: existingProd ? Number(existingProd.average_cost || 0) : 0,
                    costo_nuevo: Number(costo.toFixed(2)),
                    precio_anterior: existingProd ? Number(existingProd.price || 0) : 0,
                    precio_nuevo: Number(precioFinal.toFixed(2)),
                    margen: Number(utilPct.toFixed(2)),
                    usuario: 'EXPRESS [F1]',
                    motivo: 'Alta / Actualización Producto Express [F1]'
                }
            ].concat(Array.isArray(existingMeta.price_history) ? existingMeta.price_history.slice(0, 19) : []),
            complements_f4: Object.assign({
                sku: effectiveSku,
                logistics: logisticsF4,
                suppliers: [],
                substitutes: [],
                suggested: [],
                documents: [],
                updated_at: nowIso
            }, existingMeta.complements_f4 || {}, { logistics: logisticsF4, updated_at: nowIso }),
            created_via: 'PRODUCTO_EXPRESS_F1',
            updated_at: nowIso
        });

        var payload = {
            sku: effectiveSku,
            barcode: (existingProd && existingProd.barcode) ? existingProd.barcode : code,
            sales_code: (existingProd && existingProd.sales_code) ? existingProd.sales_code : code,
            name: name,
            description: name,
            sat_id: satId,
            sat_unidad: satUnidad,
            familia: famVal,
            departamento: depVal,
            marca: marVal,
            purchase_unit: unitName,
            sale_unit: unitName,
            piezas_por_caja: 1,
            average_cost: Number(costo.toFixed(2)),
            price: Number(precioFinal.toFixed(2)),
            stock: existingProd ? (parseFloat(existingProd.stock) || 0) : 0,
            stock_minimo: existingProd && existingProd.stock_minimo != null ? existingProd.stock_minimo : 10,
            stock_max: existingProd && existingProd.stock_max != null ? existingProd.stock_max : 100,
            stock_transito: existingProd && existingProd.stock_transito != null ? existingProd.stock_transito : 0,
            activo: true,
            meta_data: metaData
        };

        _expF1Saving = true;

        var savedProduct = Object.assign({}, existingProd || {}, payload, {
            id: (existingProd && existingProd.id) ? existingProd.id : ('EXP-' + Date.now())
        });

        try {
            var url = (existingProd && existingProd.id && !String(existingProd.id).startsWith('EXP-'))
                ? ('/api/products/' + existingProd.id)
                : '/api/products';
            var method = (existingProd && existingProd.id && !String(existingProd.id).startsWith('EXP-'))
                ? 'PUT'
                : 'POST';

            var resp = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (!resp.ok && method === 'POST') {
                // Si el SKU ya existía en backend, intentar PUT por ID
                var existingInMaster = (_masterProducts || []).find(function (p) {
                    return p && String(p.sku || '').toUpperCase() === effectiveSku && p.id;
                });
                if (existingInMaster && existingInMaster.id) {
                    resp = await fetch('/api/products/' + existingInMaster.id, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                }
            }

            if (resp && resp.ok) {
                var backendData = await resp.json();
                if (backendData && backendData.sku) {
                    backendData.meta_data = Object.assign({}, backendData.meta_data || {}, metaData);
                    savedProduct = backendData;
                }
            }
        } catch (err) {
            console.warn('[CALEBSYS Express F1] Guardado local activo:', err);
        } finally {
            _expF1Saving = false;
        }

        // Persistir e integrar inmediatamente al Catálogo de Productos (#productos)
        try {
            _persistExpressProductToLocalCustomCache(savedProduct);
            mergeIntoMasterProducts([savedProduct]);
            _allProducts = _masterProducts;
            global._productsCache = _allProducts;
            if (typeof populateFilterSelects === 'function') {
                populateFilterSelects(_allProducts);
            }
            applyClientFilters();
            selectRow(effectiveSku, true);
        } catch (uiErr) {
            console.warn('[CALEBSYS Express F1] Error actualizando vista local:', uiErr);
        }

        // Sincronizar con Punto de Venta en tiempo real
        try {
            global.dispatchEvent(new CustomEvent('calebsys:pos-pricing-updated', {
                detail: { sku: effectiveSku, product: savedProduct, source: 'express_f1' }
            }));
        } catch (e) {}

        var modeTag = isGranel ? '⚖️ A Granel (KGM)' : '📦 Por Pieza (H87)';
        toast('⚡ Producto Express [' + effectiveSku + '] "' + name + '" ($' + precioFinal.toFixed(2) + ' · ' + modeTag + ') guardado.', 'success');

        if (keepAdding) {
            var codNext = document.getElementById('exp-codigo');
            if (codNext && !String(codNext.value || '').trim()) {
                codNext.focus();
            }
        }
    };

    if (!global.__productsRealtimePricingBound) {
        global.__productsRealtimePricingBound = true;
        global.addEventListener('calebsys:pos-pricing-updated', function (ev) {
            if (ev && ev.detail && ev.detail.source === 'express_f1') return;
            var root = document.getElementById('productos-root');
            if (root && root.offsetParent !== null && !isAnyModalOpen()) {
                var inp = document.getElementById('products-search-input');
                loadProducts(inp ? inp.value : '');
            }
        });
    }

    global.loadProducts = loadProducts;
})(window);
