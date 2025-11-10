// ========================================
// VoiceNotes - Web Speech API (Online)
// Real-time transcription, mobile-optimized
// ========================================

const DB_NAME = 'VoiceNotesDB';
const DB_VERSION = 1;
const STORE_NAME = 'notes';

let db = null;
let currentNote = null;
let isRecording = false;
let recognition = null;
let lastFinalizedLength = 0;
let isRecognitionStarting = false;
let currentLanguage = 'en';
let saveTimeout = null;
let isMobileDevice = false;

// Sanitize input
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
}

// Initialize IndexedDB
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = db.createObjectStore(STORE_NAME, { 
                    keyPath: 'id', 
                    autoIncrement: true 
                });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                objectStore.createIndex('language', 'language', { unique: false });
            }
        };
    });
}

// CRUD Operations
async function saveNote(note) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const sanitizedNote = {
            title: sanitizeInput(note.title),
            text: sanitizeInput(note.text),
            language: note.language,
            timestamp: note.timestamp,
            tags: note.tags || []
        };
        if (note.id) sanitizedNote.id = note.id;
        const request = note.id ? store.put(sanitizedNote) : store.add(sanitizedNote);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAllNotes() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result.reverse());
        request.onerror = () => reject(request.error);
    });
}

async function getNote(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteNote(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// UI Elements
const elements = {
    notesList: document.getElementById('notesList'),
    noteTitleInput: document.getElementById('noteTitleInput'),
    noteTextArea: document.getElementById('noteTextArea'),
    noteTimestamp: document.getElementById('noteTimestamp'),
    noteStatus: document.getElementById('noteStatus'),
    recordBtn: document.getElementById('recordBtn'),
    deleteBtn: document.getElementById('deleteBtn'),
    exportBtn: document.getElementById('exportBtn'),
    newNoteBtn: document.getElementById('newNoteBtn'),
    searchInput: document.getElementById('searchInput'),
    languageSelect: document.getElementById('languageSelect'),
    themeToggle: document.getElementById('themeToggle'),
    helpBtn: document.getElementById('helpBtn'),
    helpModal: document.getElementById('helpModal'),
    closeHelpBtn: document.getElementById('closeHelpBtn'),
    closeHelpBtn2: document.getElementById('closeHelpBtn2'),
    deleteModal: document.getElementById('deleteModal'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    statusMessage: document.getElementById('statusMessage'),
    liveTranscription: document.getElementById('liveTranscription'),
    liveTranscriptionText: document.getElementById('liveTranscriptionText'),
    mobileMenuToggle: document.getElementById('mobileMenuToggle'),
    sidebar: document.getElementById('sidebar')
};

// Utility Functions
function showStatus(message, isError = false) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.classList.add('active');
    if (isError) {
        elements.statusMessage.classList.add('error');
    } else {
        elements.statusMessage.classList.remove('error');
    }
    setTimeout(() => elements.statusMessage.classList.remove('active'), 3000);
}

function showLoading(message = 'Processing...') {
    elements.loadingText.textContent = message;
    elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('active');
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays - 1} days ago`;
    return date.toLocaleDateString();
}

function getLanguageName(code) {
    const languages = {
        'en': 'English', 'hi': 'Hindi', 'bn': 'Bengali',
        'ta': 'Tamil', 'te': 'Telugu', 'ml': 'Malayalam',
        'kn': 'Kannada', 'mr': 'Marathi', 'gu': 'Gujarati',
        'pa': 'Punjabi', 'ur': 'Urdu'
    };
    return languages[code] || 'English';
}

function detectMobile() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    console.log('📱 Mobile device:', isMobileDevice);
    return isMobileDevice;
}

function checkInternetConnection() {
    return navigator.onLine;
}

// Note Management
function createNewNote() {
    currentNote = {
        id: null, title: '', text: '',
        language: currentLanguage, timestamp: Date.now(), tags: []
    };
    updateEditor();
    elements.noteTitleInput.focus();
    closeMobileMenu();
}

function updateEditor() {
    if (!currentNote) return;
    elements.noteTitleInput.value = currentNote.title || '';
    elements.noteTextArea.value = currentNote.text || '';
    elements.noteTimestamp.textContent = `📅 ${formatDate(currentNote.timestamp)}`;
}

async function autoSave() {
    if (!currentNote) return;
    currentNote.title = elements.noteTitleInput.value || 'Untitled Note';
    currentNote.text = elements.noteTextArea.value;
    currentNote.timestamp = Date.now();
    try {
        const id = await saveNote(currentNote);
        if (!currentNote.id) currentNote.id = id;
        elements.noteStatus.textContent = '✅ Saved';
        await loadNotes();
    } catch (error) {
        console.error('Save error:', error);
        elements.noteStatus.textContent = '⚠️ Error';
    }
}

function scheduleAutoSave() {
    elements.noteStatus.textContent = '💾 Saving...';
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(autoSave, 1000);
}

async function loadNotes() {
    try {
        const notes = await getAllNotes();
        renderNotesList(notes);
    } catch (error) {
        console.error('Load notes error:', error);
    }
}

function renderNotesList(notes) {
    if (notes.length === 0) {
        elements.notesList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div class="empty-state-title">No notes yet</div>
                <p>Create your first voice note!</p>
            </div>
        `;
        return;
    }
    
    elements.notesList.innerHTML = notes.map(note => `
        <div class="note-item ${currentNote && currentNote.id === note.id ? 'active' : ''}" 
             data-note-id="${note.id}">
            <button class="note-item-delete" 
                    data-note-id="${note.id}" 
                    aria-label="Delete note"
                    title="Delete this note">
                🗑️
            </button>
            <div class="note-item-content">
                <div class="note-item-title">${sanitizeInput(note.title) || 'Untitled'}</div>
                <div class="note-item-preview">${sanitizeInput(note.text) || 'Empty note'}</div>
                <div class="note-item-meta">
                    <span>${formatDate(note.timestamp)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Delete Functionality
function showDeleteConfirmation() {
    if (!currentNote || !currentNote.id) {
        showStatus('No note to delete', true);
        return;
    }
    elements.deleteModal.classList.add('active');
}

async function confirmDelete() {
    if (!currentNote || !currentNote.id) return;
    try {
        await deleteNote(currentNote.id);
        elements.deleteModal.classList.remove('active');
        showStatus('✅ Note deleted');
        const notes = await getAllNotes();
        if (notes.length > 0) {
            currentNote = notes[0];
            updateEditor();
        } else {
            createNewNote();
        }
        await loadNotes();
    } catch (error) {
        console.error('Delete error:', error);
        showStatus('❌ Failed to delete note', true);
    }
}


// ========================================
// Mobile-Optimized Speech Recognition
// Shows live status without interim results
// ========================================

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    
    recognition = new SpeechRecognition();
    
    if (isMobileDevice) {
        recognition.continuous = false;
        recognition.interimResults = false;
    } else {
        recognition.continuous = true;
        recognition.interimResults = true;
    }
    
    recognition.maxAlternatives = 1;
    
    const languageMap = {
        'en': 'en-US', 'hi': 'hi-IN', 'bn': 'bn-IN', 'ta': 'ta-IN',
        'te': 'te-IN', 'ml': 'ml-IN', 'kn': 'kn-IN', 'mr': 'mr-IN',
        'gu': 'gu-IN', 'pa': 'pa-IN', 'ur': 'ur-PK'
    };
    recognition.lang = languageMap[currentLanguage] || 'en-US';
    
    recognition.onstart = () => {
        console.log('🎙️ Started');
        isRecognitionStarting = false;
        lastFinalizedLength = 0;
        
        // ✅ FIX: Show appropriate message based on device
        if (elements.liveTranscriptionText) {
            if (isMobileDevice) {
                elements.liveTranscriptionText.innerHTML = `
                    <div style="text-align: center;">
                        <div style="font-size: 32px; margin-bottom: 8px; animation: pulse 1.5s infinite;">🎤</div>
                        <div style="font-weight: 600;">Recording...</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                            Text will appear when you stop
                        </div>
                    </div>
                `;
            } else {
                elements.liveTranscriptionText.textContent = '🎙️ Listening...';
            }
        }
    };
    
    recognition.onresult = (event) => {
        if (isMobileDevice) {
            handleMobileResults(event);
        } else {
            handleDesktopResults(event);
        }
    };
    
    recognition.onerror = (event) => {
        console.error('Error:', event.error);
        isRecognitionStarting = false;
        
        if (event.error === 'network') {
            stopRecording();
            showStatus('⚠️ Network error', true);
        } else if (event.error === 'no-speech' && isMobileDevice) {
            // Show feedback to user
            if (elements.liveTranscriptionText) {
                elements.liveTranscriptionText.innerHTML = `
                    <div style="text-align: center; color: var(--warning);">
                        <div style="font-size: 24px;">🔇</div>
                        <div>No speech detected</div>
                        <div style="font-size: 12px; margin-top: 4px;">Speak louder or closer to mic</div>
                    </div>
                `;
            }
            if (isRecording) setTimeout(() => safeStartRecognition(), 500);
        } else if (event.error === 'aborted' && isMobileDevice && isRecording) {
            setTimeout(() => safeStartRecognition(), 300);
        } else if (event.error === 'not-allowed') {
            stopRecording();
            showStatus('🚫 Microphone permission denied', true);
        }
    };
    
    recognition.onend = () => {
        console.log('🛑 Ended');
        isRecognitionStarting = false;
        lastFinalizedLength = 0;
        
        if (isRecording) {
            // ✅ Show "processing" message on mobile before restart
            if (isMobileDevice && elements.liveTranscriptionText) {
                elements.liveTranscriptionText.innerHTML = `
                    <div style="text-align: center;">
                        <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
                        <div>Processing...</div>
                    </div>
                `;
            }
            setTimeout(() => safeStartRecognition(), 100);
        }
    };
    
    return recognition;
}

function handleMobileResults(event) {
    for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
            const transcript = event.results[i][0].transcript.trim();
            
            // ✅ Show the transcribed text briefly before adding to note
            if (transcript && elements.liveTranscriptionText) {
                elements.liveTranscriptionText.innerHTML = `
                    <div style="text-align: center;">
                        <div style="font-size: 24px; margin-bottom: 8px; color: var(--success);">✅</div>
                        <div style="font-weight: 600; margin-bottom: 8px;">Captured:</div>
                        <div style="font-size: 14px; color: var(--text-primary);">"${transcript}"</div>
                    </div>
                `;
            }
            
            if (transcript && currentNote) {
                const cursorPos = elements.noteTextArea.selectionStart || elements.noteTextArea.value.length;
                const textBefore = elements.noteTextArea.value.substring(0, cursorPos);
                const textAfter = elements.noteTextArea.value.substring(cursorPos);
                const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
                const spacer = needsSpace ? ' ' : '';
                currentNote.text = textBefore + spacer + transcript + ' ' + textAfter;
                elements.noteTextArea.value = currentNote.text;
                const newCursorPos = cursorPos + spacer.length + transcript.length + 1;
                elements.noteTextArea.setSelectionRange(newCursorPos, newCursorPos);
                scheduleAutoSave();
            }
        }
    }
}

// Desktop remains the same
function handleDesktopResults(event) {
    let interimText = '';
    let finalText = '';
    
    for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
            finalText += transcript + ' ';
        } else {
            interimText += transcript;
        }
    }
    
    if (finalText.length > lastFinalizedLength) {
        const newText = finalText.substring(lastFinalizedLength).trim();
        if (newText && currentNote) {
            const cursorPos = elements.noteTextArea.selectionStart || elements.noteTextArea.value.length;
            const textBefore = elements.noteTextArea.value.substring(0, cursorPos);
            const textAfter = elements.noteTextArea.value.substring(cursorPos);
            const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
            const spacer = needsSpace ? ' ' : '';
            currentNote.text = textBefore + spacer + newText + ' ' + textAfter;
            elements.noteTextArea.value = currentNote.text;
            const newCursorPos = cursorPos + spacer.length + newText.length + 1;
            elements.noteTextArea.setSelectionRange(newCursorPos, newCursorPos);
            scheduleAutoSave();
        }
        lastFinalizedLength = finalText.length;
    }
    
    // ✅ Desktop: Show interim results
    if (elements.liveTranscriptionText && interimText) {
        elements.liveTranscriptionText.textContent = interimText;
    }
}


function safeStartRecognition() {
    if (isRecognitionStarting || !isRecording) return;
    if (!recognition) return;
    
    try {
        isRecognitionStarting = true;
        recognition.start();
    } catch (error) {
        isRecognitionStarting = false;
        if (error.name === 'InvalidStateError') {
            setTimeout(() => {
                isRecognitionStarting = false;
                if (isRecording) safeStartRecognition();
            }, 1000);
        } else {
            stopRecording();
            showStatus('❌ Recording failed', true);
        }
    }
}

function handleMobileResults(event) {
    for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
            const transcript = event.results[i][0].transcript.trim();
            if (transcript && currentNote) {
                const cursorPos = elements.noteTextArea.selectionStart || elements.noteTextArea.value.length;
                const textBefore = elements.noteTextArea.value.substring(0, cursorPos);
                const textAfter = elements.noteTextArea.value.substring(cursorPos);
                const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
                const spacer = needsSpace ? ' ' : '';
                currentNote.text = textBefore + spacer + transcript + ' ' + textAfter;
                elements.noteTextArea.value = currentNote.text;
                const newCursorPos = cursorPos + spacer.length + transcript.length + 1;
                elements.noteTextArea.setSelectionRange(newCursorPos, newCursorPos);
                scheduleAutoSave();
            }
        }
    }
}

function handleDesktopResults(event) {
    let interimText = '';
    let finalText = '';
    
    for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
            finalText += transcript + ' ';
        } else {
            interimText += transcript;
        }
    }
    
    if (finalText.length > lastFinalizedLength) {
        const newText = finalText.substring(lastFinalizedLength).trim();
        if (newText && currentNote) {
            const cursorPos = elements.noteTextArea.selectionStart || elements.noteTextArea.value.length;
            const textBefore = elements.noteTextArea.value.substring(0, cursorPos);
            const textAfter = elements.noteTextArea.value.substring(cursorPos);
            const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
            const spacer = needsSpace ? ' ' : '';
            currentNote.text = textBefore + spacer + newText + ' ' + textAfter;
            elements.noteTextArea.value = currentNote.text;
            const newCursorPos = cursorPos + spacer.length + newText.length + 1;
            elements.noteTextArea.setSelectionRange(newCursorPos, newCursorPos);
            scheduleAutoSave();
        }
        lastFinalizedLength = finalText.length;
    }
    
    if (elements.liveTranscriptionText && interimText) {
        elements.liveTranscriptionText.textContent = interimText;
    }
}

async function startRecording() {
    try {
        if (!currentNote) createNewNote();
        if (typeof isMobileDevice !== 'boolean') detectMobile();
        
        if (isRecording || isRecognitionStarting) return;
        
        if (!checkInternetConnection()) {
            showStatus('📵 Offline: Speech recognition requires internet', true);
            return;
        }
        
        if (!recognition) recognition = initSpeechRecognition();
        if (!recognition) {
            showStatus('⚠️ Speech recognition not supported', true);
            return;
        }
        
        const languageMap = {
            'en': 'en-US', 'hi': 'hi-IN', 'bn': 'bn-IN', 'ta': 'ta-IN',
            'te': 'te-IN', 'ml': 'ml-IN', 'kn': 'kn-IN', 'mr': 'mr-IN',
            'gu': 'gu-IN', 'pa': 'pa-IN', 'ur': 'ur-PK'
        };
        recognition.lang = languageMap[currentLanguage] || 'en-US';
        
        lastFinalizedLength = 0;
        isRecording = true;
        
        elements.liveTranscription.classList.add('active');
        elements.recordBtn.classList.add('recording');
        elements.recordBtn.textContent = '⏹️';
        
        safeStartRecognition();
        
        showStatus(`🎙️ Recording...`);
        
    } catch (error) {
        console.error('Recording error:', error);
        isRecording = false;
        isRecognitionStarting = false;
        showStatus('❌ Failed to start', true);
    }
}

function stopRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    isRecognitionStarting = false;
    
    if (recognition) {
        try { recognition.stop(); } catch (error) {}
    }
    
    lastFinalizedLength = 0;
    elements.recordBtn.classList.remove('recording');
    elements.recordBtn.textContent = '🎤';
    elements.liveTranscription.classList.remove('active');
    showStatus('✅ Stopped');
}

// Export
async function exportNotes() {
    const notes = await getAllNotes();
    if (notes.length === 0) {
        showStatus('⚠️ No notes', true);
        return;
    }
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `voicenotes-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showStatus(`✅ Exported ${notes.length} notes`);
}

// Theme
function toggleTheme() {
    const theme = document.documentElement.getAttribute('data-theme');
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    elements.themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('theme', newTheme);
}

// Mobile Menu
function toggleMobileMenu() {
    elements.sidebar.classList.toggle('open');
}

function closeMobileMenu() {
    if (window.innerWidth <= 768) {
        elements.sidebar.classList.remove('open');
    }
}

// Event Listeners
elements.newNoteBtn.addEventListener('click', createNewNote);
elements.noteTitleInput.addEventListener('input', scheduleAutoSave);
elements.noteTextArea.addEventListener('input', scheduleAutoSave);
elements.recordBtn.addEventListener('click', () => {
    if (!currentNote) createNewNote();
    isRecording ? stopRecording() : startRecording();
});
elements.deleteBtn.addEventListener('click', showDeleteConfirmation);
elements.confirmDeleteBtn.addEventListener('click', confirmDelete);
elements.cancelDeleteBtn.addEventListener('click', () => elements.deleteModal.classList.remove('active'));
elements.exportBtn.addEventListener('click', exportNotes);
elements.languageSelect.addEventListener('change', (e) => {
    currentLanguage = e.target.value;
    if (currentNote) {
        currentNote.language = currentLanguage;
        scheduleAutoSave();
    }
});
elements.themeToggle.addEventListener('click', toggleTheme);
elements.helpBtn.addEventListener('click', () => elements.helpModal.classList.add('active'));
elements.closeHelpBtn.addEventListener('click', () => elements.helpModal.classList.remove('active'));
elements.closeHelpBtn2.addEventListener('click', () => elements.helpModal.classList.remove('active'));
elements.helpModal.addEventListener('click', (e) => {
    if (e.target === elements.helpModal) elements.helpModal.classList.remove('active');
});
elements.deleteModal.addEventListener('click', (e) => {
    if (e.target === elements.deleteModal) elements.deleteModal.classList.remove('active');
});
elements.mobileMenuToggle.addEventListener('click', toggleMobileMenu);

// Notes list with delete buttons
elements.notesList.addEventListener('click', async (e) => {
    // Handle delete button
    if (e.target.classList.contains('note-item-delete') || e.target.closest('.note-item-delete')) {
        e.stopPropagation();
        
        const deleteBtn = e.target.classList.contains('note-item-delete') 
            ? e.target 
            : e.target.closest('.note-item-delete');
        
        const noteId = parseInt(deleteBtn.dataset.noteId);
        const note = await getNote(noteId);
        
        if (confirm(`Delete "${note.title || 'Untitled'}"?\n\nThis action cannot be undone.`)) {
            try {
                await deleteNote(noteId);
                showStatus('✅ Note deleted');
                
                if (currentNote && currentNote.id === noteId) {
                    const notes = await getAllNotes();
                    if (notes.length > 0) {
                        currentNote = notes[0];
                        updateEditor();
                    } else {
                        createNewNote();
                    }
                }
                
                await loadNotes();
            } catch (error) {
                console.error('Delete error:', error);
                showStatus('❌ Failed to delete', true);
            }
        }
        return;
    }
    
    // Handle note selection
    const item = e.target.closest('.note-item');
    if (item && !e.target.classList.contains('note-item-delete')) {
        const noteId = parseInt(item.dataset.noteId);
        currentNote = await getNote(noteId);
        updateEditor();
        await loadNotes();
        closeMobileMenu();
    }
});

elements.searchInput.addEventListener('input', async (e) => {
    const term = e.target.value.toLowerCase();
    const notes = await getAllNotes();
    const filtered = term ? notes.filter(n => 
        (n.title || '').toLowerCase().includes(term) ||
        (n.text || '').toLowerCase().includes(term)
    ) : notes;
    renderNotesList(filtered);
});

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        createNewNote();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        autoSave();
    }
    if (e.key === 'Escape' && isRecording) {
        e.preventDefault();
        stopRecording();
    }
});

// Network Monitoring
window.addEventListener('online', () => showStatus('✅ Online'));
window.addEventListener('offline', () => {
    showStatus('📵 Offline', true);
    if (isRecording) stopRecording();
});

// Initialize
async function initialize() {
    try {
        await initDB();
        detectMobile();
        
        const theme = localStorage.getItem('theme');
        if (theme) {
            document.documentElement.setAttribute('data-theme', theme);
            elements.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
        
        await loadNotes();
        
        const notes = await getAllNotes();
        if (notes.length === 0) {
            createNewNote();
        } else {
            currentNote = notes[0];
            updateEditor();
        }
        
        console.log('✅ VoiceNotes initialized');
        showStatus('✅ Ready!');
    } catch (error) {
        console.error('Init error:', error);
        showStatus('⚠️ Init failed', true);
    }
}

initialize();

// Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(e => console.log('SW failed:', e));
}
