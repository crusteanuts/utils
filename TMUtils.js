(function (global) {
    'use strict';

    if (global.TMUtils) return; // Prevent double load

    /*********************************************************
     * 🔧 General Utilities
     *********************************************************/
    const Utils = {

        saveToLocal(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        },

        loadFromLocal(key, fallback = null) {
            try {
                const value = localStorage.getItem(key);
                return value ? JSON.parse(value) : fallback;
            } catch {
                return fallback;
            }
        },

        showToast(message, {
            type = 'info',
            duration = 4000,
            position = { bottom: '20px', right: '20px' }
        } = {}) {

            const toastId = 'tm-global-toast';

            let toast = document.getElementById(toastId);

            if (!toast) {
                toast = document.createElement('div');
                toast.id = toastId;
                document.body.appendChild(toast);

                Object.assign(toast.style, {
                    position: 'fixed',
                    padding: '10px 16px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontFamily: 'sans-serif',
                    color: '#fff',
                    opacity: '0',
                    transform: 'translateY(20px)',
                    transition: 'all 0.25s ease',
                    zIndex: '999999'
                });
            }

            const colors = {
                success: '#28a745',
                error: '#dc3545',
                warning: '#ffc107',
                info: '#007bff'
            };

            toast.style.background = colors[type] || colors.info;
            toast.style.bottom = position.bottom;
            toast.style.right = position.right;

            toast.textContent = message;

            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateY(0)';
            });

            clearTimeout(toast._timeout);
            toast._timeout = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(20px)';
            }, duration);
        }
    };


    /*********************************************************
     * 🗄 IndexedDB Store Abstraction
     *********************************************************/
    class IndexedStore {
        static dbInstances = {};

        constructor({
            dbName = 'tm_database',
            version = 2,
            storeName
        }) {
            if (!storeName) {
                throw new Error('storeName is required');
            }

            this.dbName = dbName;
            this.version = version;
            this.storeName = storeName;
        }

        async _open() {
            if (IndexedStore.dbInstances[this.dbName]) {
                return IndexedStore.dbInstances[this.dbName];
            }

            const connect = (version) => {
                return new Promise((resolve, reject) => {
                    console.log(`[IndexedStore] Opening ${this.dbName} (v${version})`);
                    const request = indexedDB.open(this.dbName, version);

                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            db.createObjectStore(this.storeName, { keyPath: 'id' });
                            console.log(`[IndexedStore] Created store: ${this.storeName}`);
                        }
                    };

                    request.onsuccess = (event) => {
                        resolve(event.target.result);
                    };

                    request.onerror = (event) => {
                        const error = event.target.error;

                        // If the error is because the version is too low, 
                        // try to open it again with the version suggested by the error
                        if (error.name === "VersionError") {
                            // Extract the current version from the error message if possible,
                            // or simply increment the requested version by 1
                            const currentActualVersion = parseInt(error.message.match(/\d+/g)?.pop()) || version;
                            console.warn(`[IndexedStore] Version mismatch. Retrying with version ${currentActualVersion + 1}`);
                            resolve(connect(currentActualVersion + 1));
                        } else {
                            reject(error);
                        }
                    };

                    // Handle blocked connection (e.g. other tabs have the DB open with old version)
                    request.onblocked = () => {
                        console.error("[IndexedStore] Database blocked. Please close other tabs of this site.");
                    };
                });
            };

            IndexedStore.dbInstances[this.dbName] = connect(this.version);
            return IndexedStore.dbInstances[this.dbName];
        }

        async get(id) {
            const db = await this._open();

            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const request = store.get(id);

                request.onsuccess = e => resolve(e.target.result);
                request.onerror = e => reject(e.target.error);
            });
        }

        async getAll(filterFn, sortField = 'created_at', desc = true) {
            const db = await this._open();

            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.getAll();
                req.onsuccess = (e) => {
                    let result = e.target.result || [];
                    if (typeof filterFn === 'function') result = result.filter(filterFn);

                    result.sort((a, b) => {
                        a[sortField] = a.createdAtTimestamp || a.created_at || a.createdAt || a[sortField];
                        b[sortField] = b.createdAtTimestamp || b.created_at || b.createdAt || b[sortField];

                        if (!a?.[sortField] || !b?.[sortField]) return 0;
                        const aDate = new Date(a[sortField]);
                        const bDate = new Date(b[sortField]);
                        return desc ? bDate - aDate : aDate - bDate;
                    });

                    resolve(result);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        }

        async put(record) {
            if (!record?.id) {
                throw new Error('Record must contain an id field');
            }

            const db = await this._open();

            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const request = store.put(record);

                request.onsuccess = () => resolve(record);
                request.onerror = e => reject(e.target.error);
            });
        }

        async delete(id) {
            const db = await this._open();

            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const request = store.delete(id);

                request.onsuccess = () => resolve(true);
                request.onerror = e => reject(e.target.error);
            });
        }

        async clear() {
            const db = await this._open();

            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const request = store.clear();

                request.onsuccess = () => resolve(true);
                request.onerror = e => reject(e.target.error);
            });
        }
    }


    /*********************************************************
     * 🧱 Generic Panel Tool Factory
     *********************************************************/
    function createPanelTool({
        className = 'pixverse-panel',
        store,
        title = 'Panel',
        eventName = 'tm_panel_update',
        renderItemContent = null,
        renderPreview = null,
        filterFn = null,
        exportFileName = 'export.json',
        disableSearch = false,
        width = 300,
        height = 500,
        normalize = (item) => item,
        renderPreview = (item, container) => {
            const isVideo = item.type === 'video';
            container.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px; color: #eee; font-family: sans-serif;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 8px;">
                    <span style="font-weight: bold; font-size: 14px;">ID: ${item.id}</span>
                    <span style="font-size: 11px; background: #444; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${item.type}</span>
                </div>
                
                <div style="background: #000; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 200px;">
                    ${isVideo
                    ? `<video src="${item.mediaUrl}" controls autoplay style="max-width: 100%; max-height: 70vh; display: block;"></video>`
                    : `<img src="${item.mediaUrl}" style="max-width: 100%; max-height: 70vh; display: block;" />`
                }
                </div>

                ${item.prompt ? `
                    <div style="background: #222; padding: 10px; border-radius: 4px; border-left: 3px solid #007bff;">
                        <div style="font-size: 11px; color: #888; margin-bottom: 4px; text-transform: uppercase;">Prompt</div>
                        <div style="font-size: 13px; line-height: 1.4; color: #ddd;">${item.prompt}</div>
                    </div>
                ` : ''}
            </div>
        `;
        },
    }) {
        const state = { currentPage: 1, perPage: 20 };
        let panel, content, pagination, modal, modalContent;

        const dispatchUpdate = () => window.dispatchEvent(new Event(eventName));

        const renderList = async () => {
            if (!content) return;
            const searchInput = document.getElementById(`${eventName}SearchInput`);
            const query = searchInput?.value?.trim() || '';

            const items = await store.getAll(
                query && filterFn ? item => filterFn(item, query) : null
            );

            const totalPages = Math.max(1, Math.ceil(items.length / state.perPage));
            state.currentPage = Math.min(state.currentPage, totalPages);
            const paginated = items.slice((state.currentPage - 1) * state.perPage, state.currentPage * state.perPage);

            content.innerHTML = '';

            if (!paginated.length) {
                content.innerHTML = '<i style="padding:10px; color:#666;">No items found.</i>';
            } else {
                paginated.forEach(rawItem => {
                    // Normalize the item here
                    const item = normalize(rawItem);

                    const div = document.createElement('div');
                    Object.assign(div.style, {
                        marginBottom: '10px', padding: '8px', borderRadius: '4px',
                        position: 'relative', cursor: 'pointer', borderBottom: '1px solid #eee'
                    });

                    // Now we can use standard keys regardless of the API source
                    div.innerHTML = `
                        <div style="font-size:12px; font-weight:bold; color:#333;">ID: ${item.id}</div>
                        <div style="font-size:11px; color:#666;">${new Date(item.date).toLocaleString()}</div>
                        <div style="font-size:11px; color:#007bff; text-transform:uppercase;">${item.type}</div>
                    `;

                    // Render thumbnail if it exists
                    if (item.thumbnail) {
                        const img = document.createElement('img');
                        img.src = item.thumbnail;
                        img.style.cssText = 'width:80px; height:auto; margin-top:5px; border-radius:4px; display:block;';
                        div.appendChild(img);
                    }

                    if (renderItemContent) renderItemContent(div, item);

                    const del = document.createElement('span');
                    del.textContent = '🗑️';
                    del.title = 'Delete';
                    Object.assign(del.style, {
                        position: 'absolute', top: '8px', right: '8px', cursor: 'pointer'
                    });
                    del.onclick = async (e) => {
                        e.stopPropagation();
                        if (confirm('Delete item?')) {
                            await store.delete(item.id);
                            dispatchUpdate();
                            Utils.showSnackbarSuccess(`✅ Item deleted: ${item.id}`);
                        }
                    };

                    div.appendChild(del);
                    div.onclick = () => {
                        if (!renderPreview) return;
                        modalContent.innerHTML = '';
                        renderPreview(item, modalContent);
                        modal.style.display = 'flex';
                    };
                    content.appendChild(div);
                });
            }
            renderPagination(items.length);
        };

        const renderPagination = (total) => {
            pagination.innerHTML = '';
            const totalPages = Math.max(1, Math.ceil(total / state.perPage));

            const container = document.createElement('div');
            container.style.cssText = 'display:flex; gap:8px; justify-content:center; align-items:center;';

            const btnStyle = 'padding:4px 8px; font-size:13px; border:1px solid #ccc; background:#fff; border-radius:4px; cursor:pointer;';

            const createBtn = (text, page) => {
                const b = document.createElement('button');
                b.textContent = text;
                b.style.cssText = btnStyle;
                b.disabled = (page < 1 || page > totalPages || page === state.currentPage);
                if (b.disabled) b.style.opacity = '0.4';
                b.onclick = () => { state.currentPage = page; renderList(); };
                return b;
            };

            container.appendChild(createBtn('⏮', 1));
            container.appendChild(createBtn('◀', state.currentPage - 1));
            container.appendChild(createBtn('▶', state.currentPage + 1));
            container.appendChild(createBtn('⏭', totalPages));

            pagination.appendChild(container);
            const info = document.createElement('div');
            info.style.marginTop = '6px';
            info.textContent = `Page ${state.currentPage} of ${totalPages}`;
            pagination.appendChild(info);
        };

        return {
            init: function () {
                panel = document.createElement('div');
                panel.classList.add(className, 'panel-tool-instance');
                Object.assign(panel.style, {
                    position: 'fixed', bottom: '50px', right: '60px', width: `${width}px`, height: `${height}px`,
                    background: '#fff', boxShadow: '0 0 10px rgba(0,0,0,0.2)', borderRadius: '6px',
                    display: 'none', flexDirection: 'column', zIndex: '99999', fontFamily: 'sans-serif', fontSize: '14px'
                });

                const header = document.createElement('div');
                Object.assign(header.style, {
                    padding: '8px', fontWeight: 'bold', background: '#f3f3f3', borderBottom: '1px solid #ddd',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                });

                const titleEl = document.createElement('span');
                titleEl.textContent = title;
                header.appendChild(titleEl);

                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.gap = '4px';

                const makeBtn = (icon, tip, cb) => {
                    const b = document.createElement('button');
                    b.textContent = icon; b.title = tip;
                    b.style.cssText = 'cursor:pointer; background:#fff; border:1px solid #ccc; border-radius:4px; padding:2px 6px;';
                    b.onclick = (e) => { e.stopPropagation(); cb(); };
                    return b;
                };

                if (!disableSearch) {
                    actions.appendChild(makeBtn('🔎', 'Search', () => {
                        const i = document.getElementById(`${eventName}SearchInput`).parentElement;
                        i.style.display = i.style.display === 'none' ? 'block' : 'none';
                    }));
                }

                actions.appendChild(makeBtn('📤', 'Export', async () => {
                    const data = await store.getAll();
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = exportFileName;
                    a.click();
                }));

                actions.appendChild(makeBtn('📥', 'Import', () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'application/json';
                    input.onchange = async e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const text = await file.text();
                        const items = JSON.parse(text);
                        await this.bulkImport(items);
                    };
                    input.click();
                }));

                // Added Delete All Button
                actions.appendChild(makeBtn('🗑', 'Delete All', async () => {
                    if (confirm('Delete ALL items?')) {
                        const all = await store.getAll();
                        for (const item of all) await store.delete(item.id);
                        dispatchUpdate();
                        Utils.showSnackbarSuccess(`✅ All items deleted: ${all.length}`);
                    }
                }));

                header.appendChild(actions);
                panel.appendChild(header);

                if (!disableSearch) {
                    const div = document.createElement('div');
                    Object.assign(div.style, {
                        display: 'none',
                        padding: '6px', borderBottom: '1px solid #ddd'
                    });
                    const searchInput = document.createElement('input');
                    searchInput.id = `${eventName}SearchInput`;
                    searchInput.placeholder = 'Search...';
                    Object.assign(searchInput.style, {
                        width: '100%', padding: '6px', boxSizing: 'border-box',
                    });
                    searchInput.oninput = () => { state.currentPage = 1; dispatchUpdate(); };
                    div.appendChild(searchInput);
                    panel.appendChild(div);
                }

                content = document.createElement('div');
                content.style.cssText = 'flex:1; overflow-y:auto; padding:10px;';
                panel.appendChild(content);

                pagination = document.createElement('div');
                pagination.style.cssText = 'padding:6px; border-top:1px solid #ddd; text-align:center;';
                panel.appendChild(pagination);

                document.body.appendChild(panel);

                // Modal Logic
                modal = document.createElement('div');
                Object.assign(modal.style, {
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'none',
                    zIndex: '100000', padding: '40px', overflow: 'auto'
                });
                modalContent = document.createElement('div');
                Object.assign(modalContent.style, {
                    margin: 'auto', background: '#111', padding: '20px', borderRadius: '8px', maxWidth: '1000px'
                });
                modal.appendChild(modalContent);
                modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
                document.body.appendChild(modal);

                window.addEventListener(eventName, renderList);
            },
            toggle: function () {
                if (!panel) return;
                const isHidden = panel.style.display === 'none';
                document.querySelectorAll(`.${className}`).forEach(p => p.style.display = 'none');
                panel.style.display = isHidden ? 'flex' : 'none';
                if (isHidden) renderList();

                return isHidden;
            },

            async updateList(newItem, dispatch = true) {
                if (!newItem || !newItem.id) return;
                try {
                    const existing = await store.get(newItem.id);
                    const merged = existing ? { ...existing, ...newItem } : newItem;
                    await store.put(merged);
                    if (dispatch) dispatchUpdate();
                } catch (e) {
                    console.error('updateList error:', e);
                }
            },

            async bulkImport(items) {
                if (!Array.isArray(items)) return;
                for (const item of items) {
                    if (item?.id) await store.put(item);
                }
                dispatchUpdate();
                if (typeof Utils !== 'undefined') Utils.showSnackbarSuccess(`✅ Items imported: ${items.length}`);
            }
        };
    }

    class ProxyXMLHttpRequest {
        constructor(config = {}) {
            this.config = {
                OriginalXHR: XMLHttpRequest,
                shouldIntercept: () => false,
                onRequest: null,
                onResponse: null,
                onError: null,
                useFetchForIntercepted: true,
                ...config
            };

            this._reset();
        }

        _reset() {
            this.onload = null;
            this.onerror = null;
            this.onreadystatechange = null;
            this.onprogress = null;

            this.readyState = 0;
            this.status = 0;
            this.statusText = '';
            this.response = null;
            this.responseText = '';
            this.responseType = '';
            this.responseURL = '';

            this.method = null;
            this.url = null;
            this.async = true;
            this.requestHeaders = {};
            this.responseHeaders = {};
            this.eventListeners = {};
            this.controller = new AbortController();

            // ADDED: Property to store the request payload
            this.requestBody = null;
        }

        open(method, url, async = true, user = null, password = null) {
            this.method = method;
            this.url = url;
            this.async = async;
            this.user = user;
            this.password = password;

            this.readyState = 1;
            this._triggerEvent('readystatechange');
        }

        setRequestHeader(header, value) {
            this.requestHeaders[header] = value;
        }

        send(body = null) {
            this.requestBody = body;

            try {
                const shouldIntercept = this.config.shouldIntercept(this);

                if (shouldIntercept && this.config.useFetchForIntercepted) {
                    return this._handleWithFetch(body);
                }

                return this._fallbackToNative(body);
            } catch (err) {
                this._handleError(err);
            }
        }

        // New helper to simulate a complete XHR lifecycle without network
        async _handleShortCircuit(mockResponse) {
            // state: HEADERS_RECEIVED
            this.readyState = 2;
            this._triggerEvent('readystatechange');

            // state: LOADING
            this.readyState = 3;
            this._triggerEvent('readystatechange');

            // Apply the fake data
            this.status = 200;
            this.statusText = 'OK';
            this.response = mockResponse;

            // Set text response for compatibility
            if (this.responseType === '' || this.responseType === 'text') {
                this.responseText = typeof mockResponse === 'string'
                    ? mockResponse
                    : JSON.stringify(mockResponse);
            }

            // Trigger onResponse hook even for short-circuits to stay consistent
            if (typeof this.config.onResponse === 'function') {
                const modified = await this.config.onResponse(this.response, this);
                if (modified !== undefined) {
                    this.response = modified;
                    if (this.responseType === '' || this.responseType === 'text') {
                        this.responseText = typeof modified === 'string' ? modified : JSON.stringify(modified);
                    }
                }
            }

            // state: DONE
            this.readyState = 4;
            this._triggerEvent('readystatechange');

            if (this.onload) this.onload();
        }

        _fallbackToNative(body) {
            const xhr = new this.config.OriginalXHR();
            const self = this;

            xhr.open(this.method, this.url, this.async, this.user, this.password);

            Object.entries(this.requestHeaders).forEach(([k, v]) => {
                xhr.setRequestHeader(k, v);
            });

            xhr.onreadystatechange = function () {
                self.readyState = xhr.readyState;
                self._triggerEvent('readystatechange');
            };

            xhr.onload = async function () { // ADDED: Made async to support await onResponse
                self.status = xhr.status;
                self.statusText = xhr.statusText;
                self.responseURL = xhr.responseURL;
                self._parseHeaders(xhr.getAllResponseHeaders());

                self.response = xhr.response;

                // ADDED: Trigger onResponse for native fallback so you always get the hook
                if (typeof self.config.onResponse === 'function') {
                    const modified = await self.config.onResponse(self.response, self);
                    if (modified !== undefined) {
                        self.response = modified;

                        if (self.responseType === '' || self.responseType === 'text') {
                            self.responseText = typeof modified === 'string' ? modified : JSON.stringify(modified);
                        } else {
                            self.responseText = null; // or leave undefined
                        }
                    }
                }

                self.readyState = 4;
                self._triggerEvent('readystatechange');
                if (self.onload) self.onload();
            };

            xhr.onerror = function () {
                self._handleError(new Error('Native XHR error'));
            };

            xhr.responseType = this.responseType;
            xhr.send(body);
        }

        async _handleWithFetch(body) {
            let requestData = {
                method: this.method,
                url: this.url,
                headers: { ...this.requestHeaders },
                body
            };

            if (typeof this.config.onRequest === 'function') {
                const modified = await this.config.onRequest(requestData);

                if (modified?.shortCircuit) {
                    return this._handleShortCircuit(modified.response);
                }

                if (modified) requestData = modified;
            }

            // ADDED: Update the stored body in case onRequest modified the payload
            this.requestBody = requestData.body;

            this.readyState = 2;
            this._triggerEvent('readystatechange');

            const response = await fetch(requestData.url, {
                method: requestData.method,
                headers: requestData.headers,
                body: (requestData.method !== 'GET' && requestData.method !== 'HEAD') ? requestData.body : undefined,
                signal: this.controller.signal
            });

            this.status = response.status;
            this.statusText = response.statusText;
            this.responseURL = response.url;
            this._parseHeaders(response.headers);

            this.readyState = 3;
            this._triggerEvent('readystatechange');

            let data = await this._parseResponse(response);

            if (typeof this.config.onResponse === 'function') {
                // Second argument 'this' now contains the 'requestBody' property
                const modified = await this.config.onResponse(data, this);
                if (modified !== undefined) data = modified;
            }

            this.response = data;
            if (this.responseType === '' || this.responseType === 'text') {
                this.responseText = typeof data === 'string' ? data : JSON.stringify(data);
            } else {
                this.responseText = null; // or leave undefined
            }

            this.readyState = 4;
            this._triggerEvent('readystatechange');

            if (this.onload) this.onload();
        }

        _handleError(err) {
            this.readyState = 4;
            this.status = 0;

            if (typeof this.config.onError === 'function') {
                this.config.onError(err, this);
            }

            if (this.onerror) this.onerror(err);
        }

        _parseResponse(response) {
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                return response.json();
            }
            if (contentType.includes('text/') || contentType.includes('xml')) {
                return response.text();
            }
            if (this.responseType === 'blob') return response.blob();
            if (this.responseType === 'arraybuffer') return response.arrayBuffer();

            return response.text();
        }

        _parseHeaders(headers) {
            this.responseHeaders = {};

            if (headers instanceof Headers) {
                headers.forEach((value, key) => {
                    this.responseHeaders[key.toLowerCase()] = value;
                });
            } else if (typeof headers === 'string') {
                headers.split('\r\n').forEach(line => {
                    const [key, value] = line.split(': ');
                    if (key && value) {
                        this.responseHeaders[key.toLowerCase()] = value;
                    }
                });
            }
        }

        abort() {
            this.controller.abort();
            this.readyState = 0;
            this._triggerEvent('readystatechange');
        }

        getResponseHeader(header) {
            return this.responseHeaders[header.toLowerCase()] || null;
        }

        getAllResponseHeaders() {
            return Object.entries(this.responseHeaders)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n');
        }

        addEventListener(event, callback) {
            if (!this.eventListeners[event]) {
                this.eventListeners[event] = [];
            }
            this.eventListeners[event].push(callback);
        }

        _triggerEvent(event) {
            const listeners = this.eventListeners[event] || [];

            listeners.forEach(cb => {
                try {
                    cb({ type: event });
                } catch (e) { }
            });

            if (this[`on${event}`]) {
                this[`on${event}`]({ type: event });
            }
        }
    }

    class FloatingUIManager {
        constructor(options = {}) {
            this.id = options.id || 'tm-floating-ui';
            this.position = options.position || { bottom: '10px', right: '10px' };
            this.mainIcon = options.mainIcon || `<svg version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
	 width="20" height="20" fill="currentColor" viewBox="0 0 512 512"  xml:space="preserve">
<g>
	<path class="st0" d="M489.089,223.04c0,0,3.172-4.438,5.938-9.563c22.969-42.734,22.625-94.672-1.016-137.125
		c-3.797-6.797-9.734-14.484-9.734-14.484c-0.844-1.25-2.203-2.063-3.688-2.203c-1.5-0.156-3,0.391-4.063,1.453l-6.969,6.969
		l-68.531,68.531c-1.969,1.969-1.969,5.172,0,7.125l73.984,74l6.219,6.219c1.094,1.094,2.625,1.625,4.156,1.438
		C486.917,225.228,488.276,224.353,489.089,223.04z"/>
	<path class="st0" d="M454.698,248.415l-6.438-6.438l-16.063-16.063c-1.984-1.984-5.172-1.984-7.141-0.016l-32.906,32.906
		c-2.969,2.969-7.766,2.969-10.719,0l-55.391-55.391c-2.953-2.953-2.953-7.75,0-10.703l32.906-32.906
		c1.984-1.969,1.984-5.156,0-7.141l-9.641-9.641c-2.953-2.969-2.953-7.75,0-10.703l93.5-93.5l5.328-5.344
		c1.078-1.078,1.609-2.563,1.453-4.063c-0.141-1.5-0.969-2.859-2.219-3.703c0,0-3.906-3-8.625-5.75
		C383.995-12.101,312.526-4.647,265.589,42.29c-40.672,40.656-51.688,99.719-33.094,150.359L7.276,417.837
		c-9.703,9.703-9.703,25.438,0,35.141l51.297,51.297c9.719,9.703,25.438,9.703,35.141,0l225.969-225.953
		c41.969,14.547,89.391,8.969,127.203-16.766c4.078-2.781,7.313-5.547,7.313-5.547c1.141-0.891,1.875-2.234,1.969-3.672
		C456.261,250.868,455.729,249.446,454.698,248.415z M57.448,454.103c-11.813-11.813-11.813-30.984,0-42.797s30.984-11.813,42.797,0
		c11.828,11.813,11.828,30.984,0,42.797C88.433,465.931,69.261,465.931,57.448,454.103z"/>
	<path class="st0" d="M349.745,207.618c5.734,5.703,15,5.703,20.703,0l20.188-20.172c5.703-5.719,5.703-14.984,0-20.703
		c-5.734-5.719-15-5.719-20.703,0l-20.188,20.172C344.026,192.634,344.026,201.899,349.745,207.618z"/>
	<path class="st0" d="M397.776,234.946l20.172-20.188c5.719-5.719,5.719-14.984,0-20.703s-14.984-5.719-20.703,0l-20.172,20.172
		c-5.719,5.719-5.719,15,0,20.719C382.792,240.649,392.073,240.649,397.776,234.946z"/>
</g>
</svg>`;
            this.subButtons = [];
            this.buttons = options.buttons || [];

            this.expanded = false;

            this._init();
        }

        _init() {
            this.container = document.createElement('div');
            this.container.id = `${this.id}-container`;

            Object.assign(this.container.style, {
                position: 'fixed',
                bottom: this.position.bottom,
                right: this.position.right,
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column-reverse', // Stack buttons upward
                alignItems: 'center',
                gap: '10px'
            });

            document.body.appendChild(this.container);
            this._createMainButton();

            // If buttons were passed in constructor, add them now
            this.buttons.forEach(btn => this.addButton(btn));
        }

        _createMainButton() {
            this.mainButton = document.createElement('div');
            this.mainButton.innerHTML = this.mainIcon;

            Object.assign(this.mainButton.style, {
                width: '48px', height: '48px',
                backgroundColor: '#1a1a1a', color: '#fff',
                border: '2px solid #ffffff80', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
                transition: 'all 0.3s ease', userSelect: 'none', zIndex: '2'
            });

            this.mainButton.addEventListener('click', () => this.toggle());
            this.container.appendChild(this.mainButton);
        }

        // THIS IS THE KEY MISSING PIECE
        addButton(btnConfig) {
            const btn = document.createElement('div');
            btn.innerHTML = btnConfig.icon || '?';
            btn.title = btnConfig.title || '';

            Object.assign(btn.style, {
                width: '40px', height: '40px',
                backgroundColor: btnConfig.background || '#007BFF',
                color: '#fff', borderRadius: '50%',
                display: 'none', // Hidden by default until expanded
                alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: '0 3px 6px rgba(0,0,0,0.3)',
                transition: 'transform 0.2s ease', userSelect: 'none'
            });

            if (typeof btnConfig.onClick === 'function') {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    btnConfig.onClick();
                });
            }

            // Add to DOM and tracking array
            this.container.appendChild(btn);
            this.subButtons.push(btn);

            return btn;
        }

        toggle() {
            this.expanded = !this.expanded;
            this.mainButton.style.transform = this.expanded ? 'rotate(45deg)' : 'rotate(0deg)';

            this.subButtons.forEach(btn => {
                btn.style.display = this.expanded ? 'flex' : 'none';
            });

            // GENERIC FIX: If we are closing the FAB menu, 
            // also hide any open panels created by createPanelTool
            if (!this.expanded) {
                document.querySelectorAll('.panel-tool-instance').forEach(panel => {
                    panel.style.display = 'none';
                });
            }
        }
        destroy() {
            this.container?.remove();
        }
    }

    class ToolUIManager {
        constructor(options = {}) {
            this.id = options.id;
            this.db = options.db || 'tm_tools_db';
            this.toolsConfig = options.tools || [];
            this.mainIcon = options.mainIcon;
            this.tools = {};

            this._init();
        }

        _init() {
            // Initialize the floating menu container
            this.floating = new FloatingUIManager({
                id: this.id,
                mainIcon: this.mainIcon
            });

            // Loop through the "tools" array from your initUI() call
            this.toolsConfig.forEach(toolConfig => {
                this._createTool(toolConfig);
            });
        }

        _createTool(config) {
            const storeInstance = new IndexedStore({ storeName: config.store, dbName: this.db });
            const panelController = createPanelTool({ ...config, store: storeInstance });

            // 1. Build the DOM elements
            panelController.init();

            const btn = this.floating.addButton({
                title: config.title,
                icon: config.icon,
                background: config.background,
                onClick: () => {
                    const expanded = panelController.toggle() // Now this won't crash!
                    btn.style.transform = expanded ? 'rotate(45deg)' : 'rotate(0deg)';
                }
            });

            this.tools[config.id] = {
                store: storeInstance,
                panel: panelController
            }
        }
    }


    /*********************************************************
     * 🌍 Global Export
     *********************************************************/
    global.TMUtils = {
        createToolUI(options) {
            return new ToolUIManager(options);
        },
        ProxyXMLHttpRequest
    };
})(window);
