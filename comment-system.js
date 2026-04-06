/* ============================================
   COMMENT SYSTEM — Standalone Reusable Component
   Navbar + Inline Comments + Quick Fix Sidebar
   Extracted from Learning Hub, made configurable.
   ============================================ */

var CommentSystem = (function () {
  'use strict';

  // ========== DEFAULT CONFIG ==========
  var defaults = {
    storageKey: 'comments',
    instructionsKey: 'customInstructions',
    pageFile: null,
    pageTitle: null,
    projectRoot: '',
    imageUploadEndpoint: null,
    tabSelector: '.tab-btn',
    dynamicContainers: ['.queue-item'],
    navbarHeight: 56,
    promptFilePrefix: 'prompts/',
    architectureFile: null,
    onReady: null
  };

  function init(userConfig) {
    var cfg = {};
    Object.keys(defaults).forEach(function (k) { cfg[k] = defaults[k]; });
    if (userConfig) {
      Object.keys(userConfig).forEach(function (k) { cfg[k] = userConfig[k]; });
    }

    // ========== DETECT PAGE ==========
    var pathParts = window.location.pathname.split('/');
    var currentFile = cfg.pageFile || pathParts[pathParts.length - 1] || 'index.html';
    var guideTitle = cfg.pageTitle || document.title || currentFile;
    var filePath = cfg.projectRoot ? cfg.projectRoot + currentFile : currentFile;

    var STORAGE_KEY = cfg.storageKey;
    var INSTRUCTIONS_KEY = cfg.instructionsKey;
    var showImplemented = true;

    // ========== BUILD NAVBAR ==========
    var commentCount = 0;
    (function () {
      var pc = getPageComments();
      pc.forEach(function (c) {
        if (c.resolved || c.status === 'resolved') return;
        if (c.status === 'active' || !c.status) commentCount++;
        if (c.replies) { c.replies.forEach(function (r) { if (!r.implemented) commentCount++; }); }
      });
    })();
    var navHTML = '' +
      '<nav class="lh-navbar" id="lhNavbar">' +
        '<div class="lh-nav-dropdown-wrap">' +
          '<button class="lh-nav-dropdown-btn" id="lhCommentsDropBtn">Annotations <span class="lh-badge" id="lhCommentBadge"' + (commentCount > 0 ? '' : ' style="display:none;"') + '>' + commentCount + '</span></button>' +
          '<div class="lh-nav-dropdown" id="lhCommentsDropdown">' +
            '<button class="lh-nav-drop-item" id="lhCommentModeBtn">Enter Raw Annotation Mode</button>' +
            '<button class="lh-nav-drop-item" id="lhShowResolvedBtn">Show Resolved Annotations</button>' +
            '<button class="lh-nav-drop-item" id="lhResolveAllBtn">Resolve All On This Page</button>' +
            '<div class="lh-nav-drop-divider"></div>' +
            '<button class="lh-nav-drop-item" id="lhExportDataBtn">Export All Data</button>' +
            '<button class="lh-nav-drop-item" id="lhImportDataBtn">Receive Data</button>' +
            '<div class="lh-nav-drop-divider"></div>' +
            '<div class="lh-nav-drop-stats" id="lhCommentStats"></div>' +
          '</div>' +
        '</div>' +
        '<button class="lh-nav-export" id="lhBatchExport" title="Copy all annotations on this page as a batch prompt">Export Annotations</button>' +
      '</nav>';

    // ========== BUILD SIDEBAR (quick fix only) ==========
    var sidebarHTML = '' +
      '<div id="lh-sidebar" class="lh-sidebar lh-collapsed">' +
        '<div class="lh-sidebar-header">' +
          '<h2 class="lh-sidebar-title">Quick Fix</h2>' +
          '<p class="lh-sidebar-subtitle">Highlight text, describe the change, copy prompt.</p>' +
        '</div>' +
        '<div class="lh-sidebar-form">' +
          '<div class="lh-form-group">' +
            '<label class="lh-form-label">Captured Text</label>' +
            '<div class="lh-captured-text lh-empty" id="lhCapturedText">Highlight text, then click "Quick Fix"</div>' +
          '</div>' +
          '<div class="lh-form-group">' +
            '<label class="lh-form-label">What should change?</label>' +
            '<textarea class="lh-textarea" id="lhInstruction" placeholder="e.g. Rewrite this more clearly, add a visual example, fix this error..."></textarea>' +
          '</div>' +
          '<button class="lh-btn lh-btn-quickfix" id="lhQuickFixBtn">Copy Prompt for Claude Code</button>' +
          '<div class="lh-feedback" id="lhFeedback"></div>' +
        '</div>' +
        '<div class="lh-sidebar-custom" style="border-top:1px solid #dadce0;padding:0.75rem 1.25rem;margin-top:auto;">' +
          '<label class="lh-form-label">Custom Instructions</label>' +
          '<textarea class="lh-textarea" id="lhCustomInstructions" placeholder="e.g. I learn best with visual examples. Always show before/after code..." style="min-height:50px;font-size:0.78rem;"></textarea>' +
          '<div class="lh-ci-hint" id="lhCIHint" style="font-size:0.7rem;color:#9aa0a6;margin-top:0.2rem;min-height:1em;"></div>' +
        '</div>' +
      '</div>' +
      '<button id="lh-toggle" class="lh-toggle lh-toggle-shifted" title="Toggle quick fix sidebar (Ctrl+Shift+A)">&#x2039;</button>';

    // ========== INJECT ==========
    var navWrapper = document.createElement('div');
    navWrapper.innerHTML = navHTML;
    document.body.insertBefore(navWrapper.firstElementChild, document.body.firstChild);

    var sideWrapper = document.createElement('div');
    sideWrapper.innerHTML = sidebarHTML;
    while (sideWrapper.firstChild) document.body.appendChild(sideWrapper.firstChild);

    // ========== DOM REFS ==========
    var sidebar = document.getElementById('lh-sidebar');
    var toggle = document.getElementById('lh-toggle');
    var capturedTextBox = document.getElementById('lhCapturedText');
    var instructionArea = document.getElementById('lhInstruction');
    var quickFixBtn = document.getElementById('lhQuickFixBtn');
    var feedbackEl = document.getElementById('lhFeedback');
    var batchExportBtn = document.getElementById('lhBatchExport');
    var commentBadge = document.getElementById('lhCommentBadge');
    var commentModeBtn = document.getElementById('lhCommentModeBtn');
    var commentsDropBtn = document.getElementById('lhCommentsDropBtn');
    var commentsDropdown = document.getElementById('lhCommentsDropdown');
    var showResolvedBtn = document.getElementById('lhShowResolvedBtn');
    var resolveAllBtn = document.getElementById('lhResolveAllBtn');
    var customInstructionsArea = document.getElementById('lhCustomInstructions');
    var ciHint = document.getElementById('lhCIHint');

    // ========== CUSTOM INSTRUCTIONS ==========
    // Load saved custom instructions
    customInstructionsArea.value = localStorage.getItem(INSTRUCTIONS_KEY) || '';

    // Auto-save on change
    var ciSaveTimeout;
    customInstructionsArea.addEventListener('input', function () {
      clearTimeout(ciSaveTimeout);
      ciSaveTimeout = setTimeout(function () {
        localStorage.setItem(INSTRUCTIONS_KEY, customInstructionsArea.value);
        ciHint.textContent = 'Saved';
        setTimeout(function () { ciHint.textContent = ''; }, 1500);
      }, 500);
    });

    // ========== STATE ==========
    var capturedText = '';
    var floatingBar = null;
    var activeCommentPopup = null;
    var commentModeActive = false;
    var showingResolved = false;

    // ========== COMMENTS DROPDOWN ==========
    commentsDropBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      commentsDropdown.classList.toggle('lh-drop-visible');
    });

    document.addEventListener('click', function (e) {
      if (!commentsDropBtn.contains(e.target) && !commentsDropdown.contains(e.target)) {
        commentsDropdown.classList.remove('lh-drop-visible');
      }
    });

    // ========== COMMENT MODE ==========
    commentModeBtn.addEventListener('click', function () {
      commentsDropdown.classList.remove('lh-drop-visible');
      commentModeActive = !commentModeActive;
      if (commentModeActive) {
        document.body.classList.add('lh-comment-mode');
        this.textContent = 'Exit Raw Annotation Mode';
        this.classList.add('lh-comment-mode-active');
      } else {
        document.body.classList.remove('lh-comment-mode');
        this.textContent = 'Enter Raw Annotation Mode';
        this.classList.remove('lh-comment-mode-active');
      }
    });

    // ========== SHOW RESOLVED ==========
    showResolvedBtn.addEventListener('click', function () {
      commentsDropdown.classList.remove('lh-drop-visible');
      showingResolved = !showingResolved;
      if (showingResolved) {
        this.textContent = 'Hide Resolved Annotations';
        renderResolvedComments();
      } else {
        this.textContent = 'Show Resolved Annotations';
        removeResolvedOverlay();
      }
    });

    // ========== RESOLVE ALL ON THIS PAGE ==========
    resolveAllBtn.addEventListener('click', function () {
      commentsDropdown.classList.remove('lh-drop-visible');
      var all = getAllComments();
      var pageComments = all.filter(function (c) {
        return c.pageFile === currentFile && !c.resolved && c.status !== 'resolved';
      });
      if (pageComments.length === 0) {
        showToast('No unresolved annotations on this page.');
        return;
      }
      if (!confirm('Resolve all ' + pageComments.length + ' annotation(s) on this page?')) return;
      pageComments.forEach(function (c) {
        c.resolved = true;
        c.status = 'resolved';
      });
      saveAllComments(all);
      renderCommentMarkers();
      updateBadge();
      showToast(pageComments.length + ' annotation(s) resolved');
    });

    function renderResolvedComments() {
      removeResolvedOverlay();
      var resolved = getAllComments().filter(function (c) { return c.pageFile === currentFile && c.resolved; });
      if (resolved.length === 0) { showToast('No resolved annotations on this page.'); showingResolved = false; showResolvedBtn.textContent = 'Show Resolved Annotations'; return; }

      var overlay = document.createElement('div');
      overlay.id = 'lhResolvedOverlay';
      overlay.className = 'lh-resolved-overlay';

      var html = '<div class="lh-resolved-panel"><h3>Resolved Annotations</h3>';
      resolved.forEach(function (c) {
        html += '<div class="lh-resolved-item">';
        html += '<div class="lh-resolved-quote">"' + escapeHtml(c.highlightedText || '') + '"</div>';
        html += '<div class="lh-resolved-note">' + escapeHtml(c.note) + '</div>';
        if (c.replies && c.replies.length > 0) {
          c.replies.forEach(function (r) {
            html += '<div class="lh-resolved-reply">' + escapeHtml(r.text) + ' <span style="color:#9aa0a6;font-size:0.7rem;">' + new Date(r.timestamp).toLocaleString() + '</span></div>';
          });
        }
        html += '<div style="font-size:0.7rem;color:#9aa0a6;">' + new Date(c.timestamp).toLocaleString() + '</div>';
        html += '<button class="lh-unresolve-btn" data-id="' + c.id + '" style="font-size:0.75rem;color:#1a73e8;background:none;border:1px solid #dadce0;border-radius:4px;padding:0.2rem 0.5rem;cursor:pointer;margin-top:0.3rem;font-family:Arial,sans-serif;">Un-resolve</button>';
        html += '</div>';
      });
      html += '<button class="lh-resolved-close" id="lhResolvedClose">Close</button></div>';

      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('.lh-unresolve-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = this.getAttribute('data-id');
          var all = getAllComments();
          var target = all.find(function (c) { return c.id === id; });
          if (target) {
            target.status = 'implemented';
            target.resolved = false;
            saveAllComments(all);
            renderCommentMarkers();
            updateBadge();
            showToast('Annotation un-resolved');
            removeResolvedOverlay();
            renderResolvedComments();
          }
        });
      });

      document.getElementById('lhResolvedClose').addEventListener('click', function () {
        showingResolved = false;
        showResolvedBtn.textContent = 'Show Resolved Annotations';
        removeResolvedOverlay();
      });
    }

    function removeResolvedOverlay() {
      var el = document.getElementById('lhResolvedOverlay');
      if (el) el.remove();
    }

    // ========== EXPORT / IMPORT ALL DATA ==========
    document.getElementById('lhExportDataBtn').addEventListener('click', function () {
      commentsDropdown.classList.remove('lh-drop-visible');
      var data = {};
      var count = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k === STORAGE_KEY || k === INSTRUCTIONS_KEY || k.indexOf(STORAGE_KEY) === 0)) {
          data[k] = localStorage.getItem(k);
          count++;
        }
      }
      var json = JSON.stringify(data);
      navigator.clipboard.writeText(json).then(function () {
        showToast('Exported ' + count + ' data keys to clipboard');
      }).catch(function () {
        window.prompt('Copy this data:', json);
      });
    });

    document.getElementById('lhImportDataBtn').addEventListener('click', function () {
      commentsDropdown.classList.remove('lh-drop-visible');

      var overlay = document.createElement('div');
      overlay.id = 'lhImportOverlay';
      overlay.className = 'lh-resolved-overlay';
      overlay.innerHTML =
        '<div class="lh-resolved-panel">' +
          '<h3>Receive Data</h3>' +
          '<p style="font-size:0.85rem;color:#5f6368;margin-bottom:0.5rem;">Paste exported data below. This merges comments without duplicating.</p>' +
          '<textarea id="lhImportArea" style="width:100%;height:150px;font-family:monospace;font-size:0.75rem;border:1px solid #dadce0;border-radius:6px;padding:0.5rem;margin-bottom:0.5rem;" placeholder="Paste exported data here..."></textarea>' +
          '<div style="display:flex;gap:0.5rem;justify-content:flex-end;">' +
            '<button class="lh-resolved-close" id="lhImportCancel" style="background:#fff;color:#5f6368;border:1px solid #dadce0;">Cancel</button>' +
            '<button class="lh-resolved-close" id="lhImportGo" style="background:#1e8e3e;">Import</button>' +
          '</div>' +
          '<div id="lhImportStatus" style="font-size:0.82rem;margin-top:0.3rem;min-height:1.2em;"></div>' +
        '</div>';

      document.body.appendChild(overlay);

      document.getElementById('lhImportCancel').addEventListener('click', function () { overlay.remove(); });

      document.getElementById('lhImportGo').addEventListener('click', function () {
        var raw = document.getElementById('lhImportArea').value.trim();
        if (!raw) return;
        try {
          var data = JSON.parse(raw);
          var count = 0;
          Object.keys(data).forEach(function (k) {
            if (k === STORAGE_KEY) {
              // Merge by ID
              var existing = [];
              try { existing = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
              var incoming = [];
              try { incoming = JSON.parse(data[k]); } catch (e) {}
              var ids = {};
              existing.forEach(function (item) { ids[item.id] = true; });
              incoming.forEach(function (item) { if (!ids[item.id]) existing.push(item); });
              localStorage.setItem(k, JSON.stringify(existing));
            } else {
              localStorage.setItem(k, data[k]);
            }
            count++;
          });
          document.getElementById('lhImportStatus').textContent = 'Imported ' + count + ' keys! Refreshing...';
          document.getElementById('lhImportStatus').style.color = '#1e8e3e';
          setTimeout(function () { window.location.reload(); }, 1000);
        } catch (e) {
          document.getElementById('lhImportStatus').textContent = 'Error: ' + e.message;
          document.getElementById('lhImportStatus').style.color = '#d93025';
        }
      });
    });

    // Block link clicks in comment mode
    document.addEventListener('click', function (e) {
      if (!commentModeActive) return;
      var link = e.target.closest('a');
      if (link && !e.target.closest('.lh-navbar')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // ========== SIDEBAR TOGGLE ==========
    function openSidebar() {
      sidebar.classList.remove('lh-collapsed');
      toggle.innerHTML = '&#x203A;';
      toggle.classList.remove('lh-toggle-shifted');
    }

    function closeSidebar() {
      sidebar.classList.add('lh-collapsed');
      toggle.innerHTML = '&#x2039;';
      toggle.classList.add('lh-toggle-shifted');
    }

    toggle.addEventListener('click', function () {
      if (sidebar.classList.contains('lh-collapsed')) openSidebar();
      else closeSidebar();
    });

    // ========== KEYBOARD SHORTCUT (Ctrl+Shift+A) ==========
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        if (sidebar.classList.contains('lh-collapsed')) openSidebar();
        else closeSidebar();
      }
      if (e.key === 'Escape') {
        removeFloatingBar();
        removeCommentPopup();
      }
    });

    // ========== TEXT SELECTION -> FLOATING BAR ==========
    document.addEventListener('mouseup', function (e) {
      if (sidebar.contains(e.target)) return;
      if (floatingBar && floatingBar.contains(e.target)) return;
      if (activeCommentPopup && activeCommentPopup.contains(e.target)) return;
      if (e.target.closest && (e.target.closest('.lh-navbar') || e.target.closest('.lh-comment-marker'))) return;

      setTimeout(function () {
        var sel = window.getSelection();
        var text = sel ? sel.toString().trim() : '';
        if (text.length > 0) {
          showFloatingBar(e, text);
        } else {
          removeFloatingBar();
        }
      }, 10);
    });

    document.addEventListener('mousedown', function (e) {
      if (floatingBar && !floatingBar.contains(e.target)) removeFloatingBar();
      // Comment popup stays open on outside click so users can select/copy text into it.
      // Close only via Cancel, Save, Close, Escape, or clicking a different comment marker.
      if (activeCommentPopup && e.target.closest && e.target.closest('.lh-comment-marker') && !activeCommentPopup.contains(e.target)) {
        removeCommentPopup();
      }
    });

    function showFloatingBar(mouseEvent, selectedText) {
      removeFloatingBar();

      floatingBar = document.createElement('div');
      floatingBar.className = 'lh-float-bar';

      var qfBtn = document.createElement('button');
      qfBtn.className = 'lh-float-btn lh-float-qf';
      qfBtn.textContent = 'Quick Fix';
      qfBtn.title = 'Open sidebar to build a prompt';

      var cmBtn = document.createElement('button');
      cmBtn.className = 'lh-float-btn lh-float-cm';
      cmBtn.textContent = 'Comment';
      cmBtn.title = 'Add a comment (like Google Docs)';

      qfBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        capturedText = selectedText;
        capturedTextBox.textContent = selectedText;
        capturedTextBox.classList.remove('lh-empty');
        openSidebar();
        instructionArea.focus();
        removeFloatingBar();
        window.getSelection().removeAllRanges();
      });

      cmBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        // Capture DOM context before selection is lost
        var domContext = captureDOMContext();
        showCommentPopup(mouseEvent, selectedText, domContext);
        removeFloatingBar();
      });

      floatingBar.appendChild(qfBtn);
      floatingBar.appendChild(cmBtn);

      floatingBar.style.left = Math.max(8, Math.min(mouseEvent.pageX - 60, window.innerWidth - 200)) + 'px';
      var minTop = window.scrollY + cfg.navbarHeight + 4;
      var desiredTop = mouseEvent.pageY - 50;
      floatingBar.style.top = Math.max(minTop, desiredTop) + 'px';
      document.body.appendChild(floatingBar);
    }

    function removeFloatingBar() {
      if (floatingBar && floatingBar.parentNode) floatingBar.parentNode.removeChild(floatingBar);
      floatingBar = null;
    }

    // ========== DOM CONTEXT CAPTURE ==========
    function captureDOMContext() {
      try {
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;

        var range = sel.getRangeAt(0);
        var node = range.startContainer;

        // Walk up to the nearest element node
        var el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return null;

        // Build a CSS-like path: tag#id.class > tag.class (up to 4 levels)
        var path = [];
        var current = el;
        for (var i = 0; i < 4 && current && current !== document.body; i++) {
          var desc = current.tagName.toLowerCase();
          if (current.id) desc += '#' + current.id;
          if (current.className && typeof current.className === 'string') {
            var classes = current.className.trim().split(/\s+/).filter(function(c) { return !c.startsWith('lh-'); }).slice(0, 3);
            if (classes.length) desc += '.' + classes.join('.');
          }
          path.unshift(desc);
          current = current.parentElement;
        }

        // Get the active tab if any
        var activeTab = cfg.tabSelector ? document.querySelector(cfg.tabSelector + '.active') : null;
        var tabName = activeTab ? activeTab.textContent.trim() : null;

        // Get nearby heading for section context
        var heading = null;
        var walker = el;
        while (walker && walker !== document.body) {
          var prev = walker.previousElementSibling;
          while (prev) {
            if (/^H[1-6]$/.test(prev.tagName)) {
              heading = prev.textContent.trim();
              break;
            }
            prev = prev.previousElementSibling;
          }
          if (heading) break;
          walker = walker.parentElement;
        }

        return {
          cssPath: path.join(' > '),
          nearestHeading: heading,
          activeTab: tabName,
          elementTag: el.tagName.toLowerCase(),
          elementClasses: el.className || ''
        };
      } catch (e) {
        return null;
      }
    }

    // ========== IMAGE RESIZE ==========
    function resizeImage(dataUrl, maxWidth, callback) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = dataUrl;
    }

    function checkStorageUsage() {
      var total = 0;
      for (var key in localStorage) {
        if (localStorage.hasOwnProperty(key)) total += localStorage[key].length * 2; // UTF-16
      }
      return { used: total, max: 5 * 1024 * 1024, pct: Math.round(total / (5 * 1024 * 1024) * 100) };
    }

    // ========== INLINE COMMENT POPUP ==========
    function tryUploadToServer(base64, filename, callback) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', cfg.imageUploadEndpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 5000;
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            var resp = JSON.parse(xhr.responseText);
            callback(resp.path || null);
          } catch (e) { callback(null); }
        } else { callback(null); }
      };
      xhr.onerror = function () { callback(null); };
      xhr.ontimeout = function () { callback(null); };
      xhr.send(JSON.stringify({ image: base64, filename: filename }));
    }

    function showCommentPopup(mouseEvent, selectedText, domContext) {
      removeCommentPopup();

      var pendingImage = null;

      var popup = document.createElement('div');
      popup.className = 'lh-comment-popup';

      var quoteEl = document.createElement('div');
      quoteEl.className = 'lh-comment-popup-quote';
      quoteEl.textContent = '"' + (selectedText.length > 80 ? selectedText.substring(0, 80) + '...' : selectedText) + '"';

      var textarea = document.createElement('textarea');
      textarea.className = 'lh-comment-popup-input';
      textarea.placeholder = 'Edit this text... / Ask a question... / Report a visual bug...';

      // Image drop zone
      var imgZone = document.createElement('div');
      imgZone.className = 'lh-img-dropzone';
      imgZone.innerHTML = '<span class="lh-img-dropzone-text">Drop image here or click to browse</span>';

      var imgInput = document.createElement('input');
      imgInput.type = 'file';
      imgInput.accept = 'image/*';
      imgInput.style.cssText = 'display:none;';
      imgZone.appendChild(imgInput);

      var imgPreview = document.createElement('img');
      imgPreview.className = 'lh-img-preview';
      imgPreview.style.display = 'none';

      var imgRemove = document.createElement('button');
      imgRemove.className = 'lh-img-remove';
      imgRemove.textContent = '\u00D7 Remove image';
      imgRemove.style.display = 'none';

      function handleImageFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          resizeImage(e.target.result, 800, function (resized) {
            var filename = 'comment-' + Date.now() + '.png';

            if (cfg.imageUploadEndpoint) {
              tryUploadToServer(resized, filename, function (serverPath) {
                if (serverPath) {
                  pendingImage = serverPath;
                  imgPreview.src = serverPath;
                  showToast('Image saved to server');
                } else {
                  pendingImage = resized;
                  imgPreview.src = resized;
                  var usage = checkStorageUsage();
                  if (usage.pct > 80) {
                    showToast('Storage ' + usage.pct + '% full. Consider using an image server.');
                  }
                }
                imgPreview.style.display = 'block';
                imgRemove.style.display = 'inline';
                imgZone.style.display = 'none';
              });
            } else {
              // No upload endpoint — base64 only
              pendingImage = resized;
              imgPreview.src = resized;
              var usage = checkStorageUsage();
              if (usage.pct > 80) {
                showToast('Storage ' + usage.pct + '% full.');
              }
              imgPreview.style.display = 'block';
              imgRemove.style.display = 'inline';
              imgZone.style.display = 'none';
            }
          });
        };
        reader.readAsDataURL(file);
      }

      imgZone.addEventListener('click', function (e) {
        if (e.target === imgInput) return;
        imgInput.click();
      });

      imgInput.addEventListener('change', function () {
        if (this.files[0]) handleImageFile(this.files[0]);
      });

      imgZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        this.classList.add('lh-img-dragover');
      });

      imgZone.addEventListener('dragleave', function () {
        this.classList.remove('lh-img-dragover');
      });

      imgZone.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('lh-img-dragover');
        if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
      });

      imgRemove.addEventListener('click', function () {
        pendingImage = null;
        imgPreview.src = '';
        imgPreview.style.display = 'none';
        imgRemove.style.display = 'none';
        imgZone.style.display = 'block';
      });

      // Actions
      var actions = document.createElement('div');
      actions.className = 'lh-comment-popup-actions';

      var saveBtn = document.createElement('button');
      saveBtn.className = 'lh-comment-popup-save';
      saveBtn.textContent = 'Save';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'lh-comment-popup-cancel';
      cancelBtn.textContent = 'Cancel';

      cancelBtn.addEventListener('click', function () { removeCommentPopup(); });

      saveBtn.addEventListener('click', function () {
        var note = textarea.value.trim();
        if (!note) { textarea.focus(); return; }

        var comment = {
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
          timestamp: new Date().toISOString(),
          pageName: guideTitle,
          pageFile: currentFile,
          highlightedText: selectedText,
          note: note,
          image: pendingImage || null,
          x: mouseEvent.pageX,
          y: mouseEvent.pageY,
          context: domContext
        };

        var comments = getAllComments();
        comments.push(comment);
        saveAllComments(comments);
        removeCommentPopup();
        renderCommentMarkers();
        updateBadge();
        window.getSelection().removeAllRanges();
      });

      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      popup.appendChild(quoteEl);
      popup.appendChild(textarea);
      popup.appendChild(imgZone);
      popup.appendChild(imgPreview);
      popup.appendChild(imgRemove);
      popup.appendChild(actions);

      popup.style.left = Math.min(mouseEvent.pageX, window.innerWidth - 320) + 'px';
      popup.style.top = (mouseEvent.pageY + 10) + 'px';

      document.body.appendChild(popup);
      activeCommentPopup = popup;
      textarea.focus();
    }

    function removeCommentPopup() {
      if (activeCommentPopup && activeCommentPopup.parentNode) {
        activeCommentPopup.parentNode.removeChild(activeCommentPopup);
      }
      activeCommentPopup = null;
    }

    // ========== SCAN FOR IMPLEMENTATION MARKERS ==========
    // Claude Code drops <!-- lh-implemented: id1, id2 --> in the HTML when it implements comments.
    // Multiple markers may exist (one per batch). The LAST one is the newest batch.
    // Only the newest batch gets lh-new-content highlighting.
    var LATEST_BATCH_KEY = STORAGE_KEY + '_latestBatch_' + currentFile;

    function scanForImplemented() {
      var html = document.documentElement.innerHTML;
      var match = html.match(/<!--\s*lh-implemented:\s*([^>]+)\s*-->/g);

      // Fallback: walk DOM for comment nodes
      if (!match) {
        match = [];
        var walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT, null, false);
        var commentNode;
        while (commentNode = walker.nextNode()) {
          var text = commentNode.textContent.trim();
          if (text.indexOf('lh-implemented:') === 0) {
            match.push('<!-- ' + text + ' -->');
          }
        }
        if (match.length === 0) match = null;
      }
      if (!match) return;

      // Parse all batches; the last match is the newest
      var allImplementedIds = [];
      var latestBatchIds = [];
      match.forEach(function (m, i) {
        var ids = m.replace(/<!--\s*lh-implemented:\s*/, '').replace(/\s*-->/, '').split(/[,\s]+/).filter(Boolean);
        allImplementedIds = allImplementedIds.concat(ids);
        if (i === match.length - 1) latestBatchIds = ids;
      });

      if (allImplementedIds.length === 0) return;

      // Check if we already know about this latest batch
      var storedLatest = localStorage.getItem(LATEST_BATCH_KEY) || '';
      var newLatestKey = latestBatchIds.sort().join(',');
      var isNewBatch = (storedLatest !== newLatestKey);

      var all = getAllComments();
      var changed = false;
      all.forEach(function (c) {
        if (allImplementedIds.indexOf(c.id) !== -1 && c.status !== 'implemented' && c.status !== 'resolved') {
          c.status = 'implemented';
          c.isLatestBatch = latestBatchIds.indexOf(c.id) !== -1;
          changed = true;
        }
        // If we already knew about this batch, clear the isLatestBatch flag
        if (!isNewBatch && c.isLatestBatch) {
          c.isLatestBatch = false;
          changed = true;
        }
        // Mark all replies on implemented comments as handled
        if (c.status === 'implemented' && c.replies) {
          c.replies.forEach(function (r) {
            if (!r.implemented) { r.implemented = true; changed = true; }
          });
        }
      });

      if (changed) saveAllComments(all);
      if (isNewBatch) localStorage.setItem(LATEST_BATCH_KEY, newLatestKey);
    }

    // ========== FIND TEXT POSITION IN DOM ==========
    // Returns { y: number, container: element|null }
    function findTextPosition(searchText) {
      if (!searchText || searchText.length < 5) return null;

      var snippet = searchText.substring(0, 40).trim().replace(/\s+/g, ' ');
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      var node;

      // Build dynamic container selector string
      var containerSelectors = (cfg.dynamicContainers || []).join(', ') || '[data-dynamic-container]';

      while (node = walker.nextNode()) {
        if (node.parentElement && node.parentElement.closest &&
            (node.parentElement.closest('.lh-sidebar') || node.parentElement.closest('.lh-navbar') || node.parentElement.closest('.lh-comment-marker'))) {
          continue;
        }

        var normalizedText = node.textContent.replace(/\s+/g, ' ');
        if (normalizedText.indexOf(snippet) !== -1) {
          var startIdx = normalizedText.indexOf(snippet);
          if (startIdx < 0) startIdx = 0;

          // Map normalized index back to original text
          var origIdx = 0;
          var normCount = 0;
          var origText = node.textContent;
          while (normCount < startIdx && origIdx < origText.length) {
            if (/\s/.test(origText[origIdx])) {
              while (origIdx + 1 < origText.length && /\s/.test(origText[origIdx + 1])) origIdx++;
            }
            origIdx++;
            normCount++;
          }

          try {
            var range = document.createRange();
            range.setStart(node, Math.min(origIdx, origText.length));
            range.setEnd(node, Math.min(origIdx + snippet.length, origText.length));
            var rect = range.getBoundingClientRect();
            var y = rect.top + window.scrollY;
          } catch (e) {
            var y = 0;
          }

          // Check if the text is inside a dynamic container
          var el = node.parentElement;
          var container = null;
          if (el) {
            container = el.closest(containerSelectors);
          }

          return { y: y, container: container, textNode: node };
        }
      }
      return null;
    }

    // ========== COMMENT MARKERS (dots on the page) ==========
    // States: active (yellow), implemented (green checkmark), resolved (hidden)
    // Tab-aware: only show markers for the currently active tab
    function getActiveTabName() {
      if (!cfg.tabSelector) return null;
      var activeBtn = document.querySelector(cfg.tabSelector + '.active');
      return activeBtn ? activeBtn.textContent.trim() : null;
    }

    function renderCommentMarkers() {
      document.querySelectorAll('.lh-comment-marker').forEach(function (el) { el.remove(); });

      var activeTab = getActiveTabName();
      var hasTabs = cfg.tabSelector ? !!document.querySelector(cfg.tabSelector) : false;

      // Build a set of all current tab names for orphan detection
      var allTabNames = [];
      if (cfg.tabSelector) {
        document.querySelectorAll(cfg.tabSelector).forEach(function (btn) { allTabNames.push(btn.textContent.trim()); });
      }

      var comments = getPageComments().filter(function (c) {
        if (c.status === 'resolved' || c.resolved) return false;
        if (hasTabs && c.context && c.context.activeTab) {
          // If the comment's tab still exists, only show on that tab
          if (allTabNames.indexOf(c.context.activeTab) !== -1) {
            return c.context.activeTab === activeTab;
          }
          // If the comment's tab was renamed/removed, show it on ALL tabs (orphan recovery)
          return true;
        }
        return true;
      });

      // Track how many markers are placed in each container to offset them
      var containerMarkerCounts = {};

      comments.forEach(function (c) {
        var status = c.status || 'active';

        // Hide implemented markers when toggle is off
        if (status === 'implemented' && !showImplemented) return;

        var marker = document.createElement('div');
        marker.className = 'lh-comment-marker';
        marker.title = c.note;
        marker.setAttribute('data-id', c.id);

        var dotClass = 'lh-marker-dot';
        if (status === 'implemented') dotClass += ' lh-marker-implemented';

        var hasReplies = c.replies && c.replies.length > 0;

        var label = '';
        if (status === 'implemented') label = '&#x2713;';
        else if (hasReplies) label = c.replies.length;

        marker.innerHTML = '<div class="' + dotClass + (hasReplies ? ' lh-marker-has-replies' : '') + '">' + label + '</div>';

        // Try to find the text in the DOM for accurate positioning
        var posInfo = findTextPosition(c.highlightedText);

        // Check if text is inside a collapsed <details> element
        if (posInfo && posInfo.textNode) {
          var detailsAncestor = posInfo.textNode.parentElement ? posInfo.textNode.parentElement.closest('details') : null;
          if (detailsAncestor && !detailsAncestor.open) {
            // Details is collapsed — hide this marker
            return;
          }
        }

        if (posInfo && posInfo.container) {
          // Text is inside a dynamic container -- attach marker inside it
          try {
            marker.style.position = 'absolute';
            marker.style.right = '4px';
            marker.style.transform = 'none';

            var containerId = posInfo.container.getAttribute('data-id') || ('c' + Math.random().toString(36).substr(2, 4));
            var idx = containerMarkerCounts[containerId] || 0;
            containerMarkerCounts[containerId] = idx + 1;
            marker.style.top = (4 + idx * 20) + 'px';

            posInfo.container.appendChild(marker);
          } catch (e) {
            // Fallback if container is no longer in DOM
            marker.style.top = (posInfo.y || c.y) + 'px';
            document.body.appendChild(marker);
          }
        } else {
          // Standard absolute positioning on the page body
          marker.style.top = (posInfo ? posInfo.y : c.y) + 'px';
          document.body.appendChild(marker);
        }

        marker.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var fresh = getAllComments().find(function (x) { return x.id === c.id; });
          showCommentDetail(fresh || c, marker);
        });
      });
    }

    // ========== COMMENT DETAIL POPUP ==========
    function showCommentDetail(comment, markerEl) {
      removeCommentPopup();

      var popup = document.createElement('div');
      popup.className = 'lh-comment-popup lh-comment-detail';

      var quoteEl = document.createElement('div');
      quoteEl.className = 'lh-comment-popup-quote';
      quoteEl.textContent = '"' + ((comment.highlightedText || '').length > 100 ? comment.highlightedText.substring(0, 100) + '...' : (comment.highlightedText || '')) + '"';

      var noteEl = document.createElement('div');
      noteEl.className = 'lh-comment-detail-note';
      noteEl.textContent = comment.note;

      var commentImgEl = null;
      if (comment.image) {
        commentImgEl = document.createElement('img');
        commentImgEl.src = comment.image;
        commentImgEl.className = 'lh-comment-detail-img';
        commentImgEl.title = 'Click to view full size';
        commentImgEl.addEventListener('click', function () { showLightbox(comment.image); });
      }

      var statusEl = document.createElement('div');
      var st = comment.status || 'active';
      var statusLabels = { active: 'New', implemented: 'Implemented', resolved: 'Resolved' };
      var statusColors = { active: '#fbbc04', implemented: '#1e8e3e', resolved: '#9aa0a6' };
      statusEl.style.cssText = 'display:inline-block;font-size:0.7rem;font-weight:600;font-family:Arial,sans-serif;padding:2px 8px;border-radius:4px;color:#fff;background:' + (statusColors[st] || '#9aa0a6') + ';margin-bottom:0.3rem;';
      statusEl.textContent = statusLabels[st] || st;

      var timeEl = document.createElement('div');
      timeEl.className = 'lh-comment-detail-time';
      timeEl.textContent = new Date(comment.timestamp).toLocaleString();

      // Thread replies
      var threadEl = document.createElement('div');
      threadEl.className = 'lh-thread';

      var replies = comment.replies || [];
      replies.forEach(function (r) {
        var replyDiv = document.createElement('div');
        replyDiv.className = 'lh-thread-reply';
        var replyHtml = '';
        if (r.text) replyHtml += '<span class="lh-thread-reply-text">' + escapeHtml(r.text) + '</span>';
        if (r.image) {
          replyHtml += '<div class="lh-thread-reply-img-wrap"><img class="lh-thread-reply-img" src="' + escapeHtml(r.image) + '" data-lh-lightbox="1"></div>';
        }
        replyHtml += '<span class="lh-thread-reply-time">' + new Date(r.timestamp).toLocaleString() + '</span>';
        replyDiv.innerHTML = replyHtml;
        var replyImgEl = replyDiv.querySelector('[data-lh-lightbox]');
        if (replyImgEl) {
          replyImgEl.addEventListener('click', function () { showLightbox(r.image); });
        }
        threadEl.appendChild(replyDiv);
      });

      // Reply input with image support
      var replyWrap = document.createElement('div');
      replyWrap.className = 'lh-thread-reply-form';

      // Top row: textarea + reply button side by side
      var replyTopRow = document.createElement('div');
      replyTopRow.style.cssText = 'display:flex;gap:0.4rem;align-items:flex-start;';
      var replyInput = document.createElement('textarea');
      replyInput.className = 'lh-thread-reply-input';
      replyInput.placeholder = 'Reply to this thread...';
      replyInput.style.cssText = 'resize:vertical;min-height:32px;max-height:120px;flex:1;';
      replyInput.rows = 1;

      var replyPendingImage = null;
      var replyPendingImageName = '';

      // Attach image button row
      var replyImgRow = document.createElement('div');
      replyImgRow.className = 'lh-reply-img-row';
      var replyAttachBtn = document.createElement('button');
      replyAttachBtn.className = 'lh-reply-attach-btn';
      replyAttachBtn.textContent = '\uD83D\uDCF7 Attach image';
      var replyFileInput = document.createElement('input');
      replyFileInput.type = 'file';
      replyFileInput.accept = 'image/*';
      replyFileInput.style.display = 'none';

      // Preview area (shown after upload, between text field and action buttons)
      var replyPreviewRow = document.createElement('div');
      replyPreviewRow.className = 'lh-reply-preview-row';
      replyPreviewRow.style.display = 'none';
      var replyImgPreview = document.createElement('img');
      replyImgPreview.className = 'lh-reply-img-preview';
      var replyImgName = document.createElement('span');
      replyImgName.className = 'lh-reply-img-name';
      var replyImgRemove = document.createElement('button');
      replyImgRemove.className = 'lh-reply-img-remove';
      replyImgRemove.textContent = '\u00D7 Remove';
      replyPreviewRow.appendChild(replyImgPreview);
      replyPreviewRow.appendChild(replyImgName);
      replyPreviewRow.appendChild(replyImgRemove);

      function handleReplyImage(file) {
        if (!file || !file.type.startsWith('image/')) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          resizeImage(e.target.result, 800, function (resized) {
            var filename = 'reply-' + Date.now() + '.png';
            tryUploadToServer(resized, filename, function (serverPath) {
              replyPendingImage = serverPath || resized;
              replyPendingImageName = file.name;
              replyImgPreview.src = replyPendingImage;
              replyImgName.textContent = file.name;
              replyPreviewRow.style.display = 'flex';
              replyAttachBtn.textContent = '\u2705 Image attached';
            });
          });
        };
        reader.readAsDataURL(file);
      }

      replyAttachBtn.addEventListener('click', function () { replyFileInput.click(); });
      replyFileInput.addEventListener('change', function () {
        if (this.files[0]) handleReplyImage(this.files[0]);
        this.value = '';
      });

      // Drag/drop support on the attach button
      replyAttachBtn.addEventListener('dragover', function (e) { e.preventDefault(); this.style.background = '#d2e3fc'; });
      replyAttachBtn.addEventListener('dragleave', function () { this.style.background = ''; });
      replyAttachBtn.addEventListener('drop', function (e) {
        e.preventDefault();
        this.style.background = '';
        if (e.dataTransfer.files[0]) handleReplyImage(e.dataTransfer.files[0]);
      });

      replyImgRemove.addEventListener('click', function () {
        replyPendingImage = null;
        replyPendingImageName = '';
        replyImgPreview.src = '';
        replyImgName.textContent = '';
        replyPreviewRow.style.display = 'none';
        replyAttachBtn.textContent = '\uD83D\uDCF7 Attach image';
      });

      replyImgRow.appendChild(replyAttachBtn);
      replyImgRow.appendChild(replyFileInput);

      var replyBtn = document.createElement('button');
      replyBtn.className = 'lh-comment-popup-save';
      replyBtn.textContent = 'Reply';
      replyBtn.style.padding = '0.25rem 0.6rem';
      replyBtn.style.fontSize = '0.75rem';

      replyBtn.addEventListener('click', function () {
        var text = replyInput.value.trim();
        if (!text && !replyPendingImage) return;
        var all = getAllComments();
        var target = all.find(function (c) { return c.id === comment.id; });
        if (target) {
          if (!target.replies) target.replies = [];
          target.replies.push({ text: text, timestamp: new Date().toISOString(), image: replyPendingImage || null });
          saveAllComments(all);
          comment.replies = target.replies;
          showCommentDetail(comment, markerEl); // re-render
        }
      });

      replyInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); replyBtn.click(); }
      });

      replyTopRow.appendChild(replyInput);
      replyTopRow.appendChild(replyBtn);
      replyWrap.appendChild(replyTopRow);
      replyWrap.appendChild(replyImgRow);
      replyWrap.appendChild(replyPreviewRow);

      // Actions
      var actions = document.createElement('div');
      actions.className = 'lh-comment-popup-actions';

      var resolveBtn = document.createElement('button');
      resolveBtn.className = 'lh-comment-popup-save';
      resolveBtn.textContent = 'Resolve';
      resolveBtn.style.background = '#1e8e3e';
      resolveBtn.title = 'Mark as resolved -- hides the marker but keeps the comment';

      var delBtn = document.createElement('button');
      delBtn.className = 'lh-comment-popup-cancel';
      delBtn.textContent = 'Delete';
      delBtn.style.color = '#d93025';

      var closeBtn = document.createElement('button');
      closeBtn.className = 'lh-comment-popup-cancel';
      closeBtn.textContent = 'Close';

      resolveBtn.addEventListener('click', function () {
        var all = getAllComments();
        var target = all.find(function (c) { return c.id === comment.id; });
        if (target) { target.resolved = true; target.status = 'resolved'; saveAllComments(all); }
        removeCommentPopup();
        renderCommentMarkers();
        updateBadge();
        showToast('Annotation resolved');
      });

      delBtn.addEventListener('click', function () {
        var comments = getAllComments().filter(function (c) { return c.id !== comment.id; });
        saveAllComments(comments);
        removeCommentPopup();
        renderCommentMarkers();
        updateBadge();
      });

      closeBtn.addEventListener('click', function () { removeCommentPopup(); });

      actions.appendChild(resolveBtn);
      actions.appendChild(delBtn);
      actions.appendChild(closeBtn);
      popup.appendChild(statusEl);
      popup.appendChild(quoteEl);
      popup.appendChild(noteEl);
      if (commentImgEl) popup.appendChild(commentImgEl);
      popup.appendChild(timeEl);
      popup.appendChild(threadEl);
      popup.appendChild(replyWrap);
      popup.appendChild(actions);

      var rect = markerEl.getBoundingClientRect();
      popup.style.left = Math.min(rect.left - 280, window.innerWidth - 320) + 'px';
      popup.style.top = (rect.top + window.scrollY) + 'px';

      document.body.appendChild(popup);
      activeCommentPopup = popup;

      // Clamp popup so bottom doesn't go below viewport
      var popupRect = popup.getBoundingClientRect();
      if (popupRect.bottom > window.innerHeight) {
        var newTop = Math.max(0, window.innerHeight - popupRect.height + window.scrollY);
        popup.style.top = newTop + 'px';
      }
    }

    // ========== COMMENT STORAGE ==========
    function getAllComments() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
      catch (e) { return []; }
    }

    function getPageComments() {
      return getAllComments().filter(function (c) { return c.pageFile === currentFile; });
    }

    function saveAllComments(comments) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
    }

    // ========== BADGE & STATS ==========
    function updateBadge() {
      var pageComments = getPageComments();

      // Count by status
      var counts = { active: 0, implemented: 0, resolved: 0 };
      var totalItems = 0;
      pageComments.forEach(function (c) {
        var st = (c.resolved || c.status === 'resolved') ? 'resolved' : (c.status || 'active');
        counts[st] = (counts[st] || 0) + 1;
        totalItems++;
        if (c.replies) totalItems += c.replies.length;
      });

      // Export button badge: active parents + unhandled replies on implemented
      var exportReady = counts.active;
      pageComments.forEach(function (c) {
        if (c.resolved || c.status === 'resolved') return;
        if (c.replies) {
          c.replies.forEach(function (r) { if (!r.implemented) exportReady++; });
        }
      });

      // Comments dropdown badge: same as export-ready count
      if (exportReady > 0) {
        commentBadge.textContent = exportReady;
        commentBadge.style.display = 'inline';
      } else {
        commentBadge.style.display = 'none';
      }

      var exportBadgeEl = batchExportBtn.querySelector('.lh-badge');
      if (!exportBadgeEl) {
        exportBadgeEl = document.createElement('span');
        exportBadgeEl.className = 'lh-badge';
        batchExportBtn.appendChild(exportBadgeEl);
      }
      if (exportReady > 0) {
        exportBadgeEl.textContent = exportReady;
        exportBadgeEl.style.display = 'inline';
      } else {
        exportBadgeEl.style.display = 'none';
      }

      // Stats in dropdown
      var statsEl = document.getElementById('lhCommentStats');
      if (statsEl) {
        statsEl.innerHTML =
          '<span class="lh-stat-dot" style="background:#fbbc04;"></span> ' + counts.active + ' new &nbsp;&nbsp;' +
          '<label class="lh-stat-toggle" style="cursor:pointer;">' +
            '<input type="checkbox" id="lhToggleImplemented"' + (showImplemented ? ' checked' : '') + ' style="margin:0 4px 0 0;vertical-align:middle;">' +
            '<span class="lh-stat-dot" style="background:#1e8e3e;"></span> ' + counts.implemented + ' implemented' +
          '</label> &nbsp;&nbsp;' +
          '<span class="lh-stat-dot" style="background:#9aa0a6;"></span> ' + counts.resolved + ' resolved';

        var toggleCb = document.getElementById('lhToggleImplemented');
        if (toggleCb) {
          toggleCb.addEventListener('change', function () {
            showImplemented = this.checked;
            renderCommentMarkers();
          });
        }
      }
    }

    // ========== QUICK FIX PROMPT ==========
    quickFixBtn.addEventListener('click', function () {
      var text = capturedText;
      var instruction = instructionArea.value.trim();

      if (!text && !instruction) {
        showFeedback('Highlight some text first.', true);
        return;
      }

      var ci = (localStorage.getItem(INSTRUCTIONS_KEY) || '').trim();

      var promptFilePath = cfg.promptFilePrefix + currentFile.replace('.html', '') + '.prompt.txt';

      var prompt = '';
      if (cfg.architectureFile) {
        prompt += 'FIRST (if you haven\'t already in this conversation): Read `' + cfg.architectureFile + '` -- it is the single source of truth for this project. Follow its conventions.\n\n';
      }
      prompt += 'THIS IS A QUICK FIX from the comment/annotation system.\n\n';
      prompt += 'Edit the file `' + filePath + '`.\n\n';

      if (text) {
        prompt += 'Find this text in the file:\n> ' + text + '\n\n';
      }

      if (instruction) {
        prompt += 'What I want: ' + instruction + '\n\n';
      }

      if (ci) {
        prompt += 'My standing instructions: ' + ci + '\n\n';
      }
      prompt += 'Guidelines:\n';
      prompt += '- Keep the existing HTML/CSS structure intact\n';
      prompt += '- My request may be: a text edit, a question needing elaboration, a request to reorganize content, or a visual bug report\n';
      prompt += '- If I asked for an explanation, add it as a styled callout box near the relevant text\n';
      prompt += '- If I described a visual bug (overflow, alignment, sizing), diagnose and fix the CSS/HTML causing it\n';
      prompt += '- If I asked for a visual example, create one using inline HTML/CSS\n';
      prompt += '- Assume I know very little about code -- keep explanations simple\n';
      prompt += '- Do not change anything else on the page\n';
      prompt += '- Append this edit request (with a timestamp header) to `' + promptFilePath + '` as a changelog entry\n';
      prompt += '- CHANGE HIGHLIGHTING: First, remove any existing `class="lh-new-content"` spans from previous edits (unwrap them, keeping inner content). Then wrap ALL new or modified content in `<span class="lh-new-content">...</span>` so the user can see what changed.';

      copyText(prompt, quickFixBtn, 'Copy Prompt for Claude Code');
    });

    // ========== LINE NUMBER FETCHING ==========
    function fetchLineNumbers(comments) {
      return fetch('/' + filePath)
        .then(function (res) {
          if (!res.ok) throw new Error('Server returned ' + res.status);
          return res.text();
        })
        .then(function (html) {
          var lines = html.split('\n');
          var lineMap = {};
          comments.forEach(function (item) {
            var c = item.comment || item;
            if (!c.highlightedText) return;
            var needle = c.highlightedText.trim();
            if (needle.length < 5) return;
            for (var i = 0; i < lines.length; i++) {
              if (lines[i].indexOf(needle) !== -1 || (needle.length > 60 && lines[i].indexOf(needle.substring(0, 60)) !== -1)) {
                lineMap[c.id] = i + 1;
                break;
              }
            }
          });
          return lineMap;
        })
        .catch(function () {
          return {};
        });
    }

    // ========== BATCH EXPORT (export-ready comments only) ==========
    batchExportBtn.addEventListener('click', function () {
      var allPageComments = getPageComments();

      // Collect export-ready items: active comments + new replies on implemented comments
      var exportItems = [];
      var exportedCommentIds = [];

      allPageComments.forEach(function (c) {
        if (c.resolved || c.status === 'resolved') return;
        var st = c.status || 'active';

        if (st === 'active') {
          exportItems.push({ type: 'new', comment: c });
          exportedCommentIds.push(c.id);
        } else if (st === 'implemented' && c.replies) {
          var newReplies = c.replies.filter(function (r) { return !r.implemented; });
          if (newReplies.length > 0) {
            exportItems.push({ type: 'follow-up', comment: c, newReplies: newReplies });
          }
        }
      });

      if (exportItems.length === 0) {
        showToast('No new annotations to export.');
        return;
      }

      var customInstructions = localStorage.getItem(INSTRUCTIONS_KEY) || '';
      var promptFilePath = cfg.promptFilePrefix + currentFile.replace('.html', '') + '.prompt.txt';

      // Fetch line numbers asynchronously, then build the prompt
      fetchLineNumbers(exportItems).then(function (lineMap) {

      var prompt = '';
      if (cfg.architectureFile) {
        prompt += 'FIRST (if you haven\'t already in this conversation): Read `' + cfg.architectureFile + '` -- it is the single source of truth for this project. Follow its conventions.\n\n';
      }
      prompt += 'FIRST run this setup command (activates the automation hooks for this batch):\n';
      prompt += '```\ntouch /tmp/lh-annotation-session && echo "' + exportedCommentIds.join(', ') + '" > /tmp/lh-batch-ids.txt\n```\n\n';
      prompt += 'THIS IS AN EXPORTED ANNOTATION BATCH from the annotation system.\n\n';
      prompt += 'Edit the file `' + filePath + '`.\n\n';

      if (customInstructions) {
        prompt += 'My standing instructions: ' + customInstructions + '\n\n';
      }
      prompt += 'Guidelines:\n';
      prompt += '- Keep the existing HTML/CSS structure intact\n';
      prompt += '- Comments may be one of several types -- read each carefully:\n';
      prompt += '  - TEXT EDIT: if the comment rewrites/corrects the highlighted text, replace it\n';
      prompt += '  - QUESTION: if the comment asks a question or requests elaboration, add a clear explanation near the highlighted text (as a styled callout box)\n';
      prompt += '  - REORGANIZE: if the comment suggests moving content from elsewhere on the page to this location, do so\n';
      prompt += '  - BUG REPORT: if the comment describes a visual problem (overflow, alignment, sizing), use the DOM path and location context to find and fix the CSS/HTML causing it\n';
      prompt += '- Use the "Location context" (tab name, heading, DOM path) to pinpoint where in the file to make changes\n';
      prompt += '- For each annotation, identify the exact old_string and new_string for the Edit tool. Do not re-read sections you have already read.\n';
      prompt += '- Assume I know very little about code -- keep explanations simple\n';
      prompt += '- Append these edit requests (with a timestamp header) to `' + promptFilePath + '` as a changelog entry\n';
      prompt += '- CHANGE HIGHLIGHTING: Remove existing `class="lh-new-content"` spans (unwrap them). Wrap ALL new/modified content in `<span class="lh-new-content">...</span>`.\n';
      prompt += '- IMPLEMENTATION TRACKING: After making all changes, add this HTML comment at the end of the file (before </body>): `<!-- lh-implemented: ' + exportedCommentIds.join(', ') + ' -->`. This tells the annotation system which comments were implemented.\n\n';
      prompt += '---\n\n';

      exportItems.forEach(function (item, i) {
        var c = item.comment;
        prompt += '### Comment ' + (i + 1) + ' [ID: ' + c.id + ']\n\n';

        if (item.type === 'follow-up') {
          prompt += '*This is a follow-up on a previously implemented annotation.*\n\n';
          if (c.highlightedText) {
            var lineInfo = lineMap[c.id] ? 'Line ' + lineMap[c.id] + ': ' : '';
            prompt += 'Find this text:\n> ' + lineInfo + c.highlightedText + '\n\n';
          }
          prompt += 'Original comment: ' + c.note + '\n\n';
          if (c.replies && c.replies.length > 0) {
            prompt += 'Full thread history:\n';
            c.replies.forEach(function (r) {
              var isNew = !r.implemented;
              prompt += (isNew ? '- **[NEW]** ' : '- [previously seen] ') + r.text + '\n';
            });
            prompt += '\n';
          }
        } else {
          if (c.highlightedText) {
            var lineInfo = lineMap[c.id] ? 'Line ' + lineMap[c.id] + ': ' : '';
            prompt += 'Find this text:\n> ' + lineInfo + c.highlightedText + '\n\n';
          }
          if (c.note) prompt += 'My comment: ' + c.note + '\n\n';
          if (c.image) prompt += 'Attached screenshot:\n![Screenshot](' + c.image + ')\n\n';
          if (c.replies && c.replies.length > 0) {
            prompt += 'Thread replies:\n';
            c.replies.forEach(function (r) {
              prompt += '- ' + r.text + '\n';
              if (r.image) prompt += '  Attached screenshot: ![Screenshot](' + r.image + ')\n';
            });
            prompt += '\n';
          }
        }

        if (c.context) {
          prompt += 'Location context:\n';
          if (c.context.activeTab) prompt += '- Active tab: "' + c.context.activeTab + '"\n';
          if (c.context.nearestHeading) prompt += '- Under heading: "' + c.context.nearestHeading + '"\n';
          if (c.context.cssPath) prompt += '- DOM path: `' + c.context.cssPath + '`\n';
          prompt += '\n';
        }
        prompt += '---\n\n';
      });

      // Mark follow-up replies as sent
      var all = getAllComments();
      all.forEach(function (c) {
        if (c.status === 'implemented' && c.replies) {
          c.replies.forEach(function (r) { if (!r.implemented) r.implemented = true; });
        }
      });
      saveAllComments(all);
      updateBadge();

      prompt += 'FINALLY, when all edits are complete, run this cleanup command:\n';
      prompt += '```\nrm -f /tmp/lh-annotation-session /tmp/lh-batch-ids.txt\n```\n';

      copyText(prompt, batchExportBtn, 'Export Annotations');

      }); // end fetchLineNumbers.then
    });

    // ========== FEEDBACK ==========
    function showFeedback(msg, isError) {
      feedbackEl.textContent = msg;
      feedbackEl.className = 'lh-feedback' + (isError ? ' lh-error' : '');
      setTimeout(function () { feedbackEl.textContent = ''; }, 3000);
    }

    // ========== DYNAMIC CONTENT CHANGE LISTENER ==========
    // Re-render markers when dynamic content changes
    // Dispatches lh-content-changed so external systems can hook in
    document.addEventListener('lh-content-changed', function () {
      setTimeout(function () {
        renderCommentMarkers();
        updateBadge();
      }, 50);
    });

    // ========== TAB SWITCH -> RE-RENDER MARKERS ==========
    if (cfg.tabSelector) {
      document.addEventListener('click', function (e) {
        if (e.target.matches && e.target.matches(cfg.tabSelector)) {
          setTimeout(function () { renderCommentMarkers(); }, 50);
        }
      });
    }

    // ========== TOAST NOTIFICATIONS ==========
    function showToast(msg) {
      var toast = document.createElement('div');
      toast.className = 'lh-toast';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
      }, 2500);
    }

    function showLightbox(src) {
      var overlay = document.createElement('div');
      overlay.className = 'lh-lightbox-overlay';
      var img = document.createElement('img');
      img.className = 'lh-lightbox-img';
      img.src = src;
      var closeBtn = document.createElement('button');
      closeBtn.className = 'lh-lightbox-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', function () { overlay.remove(); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
      var escHandler = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
      document.addEventListener('keydown', escHandler);
      overlay.appendChild(img);
      overlay.appendChild(closeBtn);
      document.body.appendChild(overlay);
    }

    // ========== CLIPBOARD UTILITY ==========
    function copyText(text, btn, originalLabel) {
      function showCopied() {
        var savedChildren = [];
        while (btn.childNodes.length > 0) {
          var child = btn.childNodes[0];
          if (child.nodeType === 1) savedChildren.push(btn.removeChild(child));
          else btn.removeChild(child);
        }
        btn.appendChild(document.createTextNode('Copied! '));
        savedChildren.forEach(function (c) { btn.appendChild(c); });

        showToast('Copied to clipboard -- paste into Claude Code');

        setTimeout(function () {
          while (btn.childNodes.length > 0) {
            var child = btn.childNodes[0];
            if (child.nodeType === 1) savedChildren.push(btn.removeChild(child));
            else btn.removeChild(child);
          }
          // Remove duplicates
          var seen = {};
          savedChildren = savedChildren.filter(function (c) {
            if (seen[c.className]) return false;
            seen[c.className] = true;
            return true;
          });
          btn.appendChild(document.createTextNode(originalLabel + ' '));
          savedChildren.forEach(function (c) { btn.appendChild(c); });
        }, 2000);
      }

      navigator.clipboard.writeText(text).then(showCopied).catch(function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showCopied();
      });
    }

    // ========== HTML ESCAPE ==========
    function escapeHtml(str) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(str));
      return div.innerHTML;
    }

    // ========== DETAILS TOGGLE LISTENER ==========
    // Re-render markers when <details> elements are opened/closed
    document.querySelectorAll('details').forEach(function (det) {
      det.addEventListener('toggle', function () { renderCommentMarkers(); });
    });

    // ========== STARTUP ==========
    renderCommentMarkers();
    updateBadge();
    setTimeout(function () {
      scanForImplemented();
      // Dispatch event so external systems (queue, etc.) can react
      document.dispatchEvent(new Event('lh-content-changed'));
      renderCommentMarkers();
      updateBadge();
    }, 200);

    // Fire onReady callback
    if (typeof cfg.onReady === 'function') {
      cfg.onReady();
    }
  }

  return { init: init };

})();
