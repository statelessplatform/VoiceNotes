// ========================================
// VoiceNotes - Hybrid Speech Recognition
// Web Speech API (online) + Manual fallback (offline)
// ========================================

// ========================================
// IndexedDB Setup and Operations
// ========================================

const DB_NAME = 'VoiceNotesDB';
const DB_VERSION = 1;
const STORE_NAME = 'notes';

let db = null;

// Sanitize input to prevent XSS
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
            summary: note.summary ? sanitizeInput(note.summary) : null,
            language: note.language,
            timestamp: note.timestamp,
            tags: note.tags || []
        };
        
        if (note.id) {
            sanitizedNote.id = note.id;
        }
        
        const request = note.id ? store.put(sanitizedNote) : store.add(sanitizedNote);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.error('IndexedDB save error:', request.error);
            reject(request.error);
        };
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

// ========================================
// Application State
// ========================================

let currentNote = null;
let isRecording = false;
let recognition = null;
let interimTranscript = '';
let finalTranscript = '';
let currentLanguage = 'en';
let saveTimeout = null;
let networkStatus = 'online'; // Track network status

// ========================================
// UI Elements
// ========================================

const elements = {
    notesList: document.getElementById('notesList'),
    noteTitleInput: document.getElementById('noteTitleInput'),
    noteTextArea: document.getElementById('noteTextArea'),
    noteTimestamp: document.getElementById('noteTimestamp'),
    noteLanguage: document.getElementById('noteLanguage'),
    noteStatus: document.getElementById('noteStatus'),
    tagsContainer: document.getElementById('tagsContainer'),
    recordBtn: document.getElementById('recordBtn'),
    summarizeBtn: document.getElementById('summarizeBtn'),
    exportBtn: document.getElementById('exportBtn'),
    newNoteBtn: document.getElementById('newNoteBtn'),
    searchInput: document.getElementById('searchInput'),
    languageSelect: document.getElementById('languageSelect'),
    themeToggle: document.getElementById('themeToggle'),
    helpBtn: document.getElementById('helpBtn'),
    helpModal: document.getElementById('helpModal'),
    closeHelpBtn: document.getElementById('closeHelpBtn'),
    closeHelpBtn2: document.getElementById('closeHelpBtn2'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    statusMessage: document.getElementById('statusMessage'),
    summarySection: document.getElementById('summarySection'),
    summaryText: document.getElementById('summaryText'),
    liveTranscription: document.getElementById('liveTranscription'),
    liveTranscriptionText: document.getElementById('liveTranscriptionText')
};

// ========================================
// Utility Functions
// ========================================

function showStatus(message, isError = false) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.classList.add('active');
    if (isError) {
        elements.statusMessage.classList.add('error');
    } else {
        elements.statusMessage.classList.remove('error');
    }
    
    setTimeout(() => {
        elements.statusMessage.classList.remove('active');
    }, 3000);
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
        'en': 'English',
        'hi': 'Hindi',
        'bn': 'Bengali',
        'ta': 'Tamil',
        'te': 'Telugu',
        'ml': 'Malayalam',
        'kn': 'Kannada',
        'mr': 'Marathi',
        'gu': 'Gujarati',
        'pa': 'Punjabi',
        'ur': 'Urdu'
    };
    return languages[code] || 'English';
}

function checkInternetConnection() {
    return navigator.onLine;
}

function updateNetworkStatus() {
    const isOnline = checkInternetConnection();
    networkStatus = isOnline ? 'online' : 'offline';
    
    // Update UI to show network status
    const headerTitle = document.querySelector('.header-title');
    if (headerTitle) {
        const statusIndicator = headerTitle.querySelector('.network-status');
        if (statusIndicator) {
            statusIndicator.remove();
        }
        
        if (!isOnline) {
            const offlineIndicator = document.createElement('span');
            offlineIndicator.className = 'network-status';
            offlineIndicator.textContent = '📵 Offline';
            offlineIndicator.style.cssText = 'font-size: 12px; color: #ef4444; margin-left: 8px;';
            headerTitle.appendChild(offlineIndicator);
        }
    }
    
    return isOnline;
}

// ========================================
// Note Management
// ========================================

function createNewNote() {
    currentNote = {
        id: null,
        title: '',
        text: '',
        summary: null,
        language: currentLanguage,
        timestamp: Date.now(),
        tags: []
    };
    updateEditor();
    elements.noteTitleInput.focus();
}

function updateEditor() {
    if (!currentNote) return;
    
    elements.noteTitleInput.value = currentNote.title || '';
    elements.noteTextArea.value = currentNote.text || '';
    elements.noteTimestamp.textContent = `📅 ${formatDate(currentNote.timestamp)}`;
    elements.noteLanguage.textContent = `🌐 ${getLanguageName(currentNote.language)}`;
    
    if (currentNote.summary) {
        elements.summarySection.style.display = 'block';
        elements.summaryText.textContent = currentNote.summary;
    } else {
        elements.summarySection.style.display = 'none';
    }
}

async function autoSave() {
    if (!currentNote) return;
    
    currentNote.title = elements.noteTitleInput.value || 'Untitled Note';
    currentNote.text = elements.noteTextArea.value;
    currentNote.timestamp = Date.now();
    
    try {
        const id = await saveNote(currentNote);
        if (!currentNote.id) {
            currentNote.id = id;
        }
        elements.noteStatus.textContent = '✅ Saved';
        await loadNotes();
    } catch (error) {
        console.error('Save error:', error);
        elements.noteStatus.textContent = '⚠️ Error';
        showStatus('Failed to save note', true);
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
            <div class="note-item-title">${sanitizeInput(note.title) || 'Untitled'}</div>
            <div class="note-item-preview">${sanitizeInput(note.text) || 'Empty note'}</div>
            <div class="note-item-meta">
                <span>${formatDate(note.timestamp)}</span>
                <span>🌐 ${getLanguageName(note.language)}</span>
            </div>
        </div>
    `).join('');
}

// ========================================
// Speech Recognition - Hybrid Approach
// Web Speech API (online) + Manual fallback
// ========================================

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn('Web Speech API not supported in this browser');
        return null;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    
    const languageMap = {
        'en': 'en-US',
        'hi': 'hi-IN',
        'bn': 'bn-IN',
        'ta': 'ta-IN',
        'te': 'te-IN',
        'ml': 'ml-IN',
        'kn': 'kn-IN',
        'mr': 'mr-IN',
        'gu': 'gu-IN',
        'pa': 'pa-IN',
        'ur': 'ur-PK'
    };
    
    recognition.lang = languageMap[currentLanguage] || 'en-US';
    
    recognition.onstart = () => {
        console.log('🎙️ Speech recognition started');
        interimTranscript = '';
        finalTranscript = '';
        
        if (elements.liveTranscriptionText) {
            elements.liveTranscriptionText.innerHTML = '<span class="interim">Listening...</span>';
        }
    };
    
    recognition.onresult = (event) => {
        interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
                
                // Add to note immediately
                if (currentNote) {
                    const cursorPos = elements.noteTextArea.selectionStart;
                    const textBefore = elements.noteTextArea.value.substring(0, cursorPos);
                    const textAfter = elements.noteTextArea.value.substring(cursorPos);
                    
                    currentNote.text = textBefore + transcript + ' ' + textAfter;
                    elements.noteTextArea.value = currentNote.text;
                    
                    // Move cursor to end of inserted text
                    const newCursorPos = cursorPos + transcript.length + 1;
                    elements.noteTextArea.setSelectionRange(newCursorPos, newCursorPos);
                    
                    scheduleAutoSave();
                }
            } else {
                interimTranscript += transcript;
            }
        }
        
        // Update live transcription display
        if (elements.liveTranscriptionText) {
            elements.liveTranscriptionText.innerHTML = `
                <span>${finalTranscript}</span>
                <span class="interim">${interimTranscript}</span>
            `;
        }
    };
    
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        
        let errorMessage = 'Speech recognition error';
        let shouldStop = false;
        let showOfflineHelp = false;
        
        switch(event.error) {
            case 'network':
                errorMessage = '⚠️ Network error. Check your internet connection.';
                shouldStop = true;
                showOfflineHelp = true;
                break;
            case 'no-speech':
                errorMessage = '🔇 No speech detected. Please speak clearly.';
                // Don't stop, just notify
                break;
            case 'audio-capture':
                errorMessage = '🎤 Microphone not accessible. Check permissions.';
                shouldStop = true;
                break;
            case 'not-allowed':
                errorMessage = '🚫 Microphone permission denied. Enable in browser settings.';
                shouldStop = true;
                break;
            case 'service-not-allowed':
                errorMessage = '⚠️ Speech service blocked. Check browser permissions.';
                shouldStop = true;
                break;
            case 'aborted':
                errorMessage = '⏹️ Speech recognition stopped';
                shouldStop = true;
                break;
            case 'language-not-supported':
                errorMessage = `❌ Language "${recognition.lang}" not supported`;
                shouldStop = true;
                break;
            default:
                errorMessage = `❌ Error: ${event.error}`;
                shouldStop = true;
        }
        
        showStatus(errorMessage, true);
        
        if (showOfflineHelp) {
            setTimeout(() => {
                showStatus('💡 Tip: You can type your notes manually when offline', false);
            }, 3500);
        }
        
        if (shouldStop) {
            stopRecording();
        }
    };
    
    recognition.onend = () => {
        console.log('🛑 Speech recognition ended');
        
        // Only restart if:
        // 1. Still in recording mode
        // 2. Online
        // 3. No critical errors
        if (isRecording && checkInternetConnection()) {
            setTimeout(() => {
                try {
                    recognition.start();
                    console.log('♻️ Restarting speech recognition...');
                } catch (error) {
                    console.error('Failed to restart recognition:', error);
                    stopRecording();
                    showStatus('⚠️ Recording stopped. Click mic to restart.', true);
                }
            }, 100); // Small delay to prevent rapid loops
        } else if (isRecording && !checkInternetConnection()) {
            stopRecording();
            showStatus('📵 Offline: Speech recognition requires internet', true);
        }
    };
    
    return recognition;
}

async function startRecording() {
    try {
        if (!currentNote) createNewNote();
        
        // Check if browser supports Web Speech API
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            showStatus('⚠️ Speech recognition not supported. Please type your note.', true);
            elements.noteTextArea.focus();
            return;
        }
        
        // Check internet connection
        if (!checkInternetConnection()) {
            showStatus('📵 Offline: Speech recognition requires internet. You can type instead.', true);
            elements.noteTextArea.focus();
            
            // Offer manual input
            const shouldType = confirm(
                'Speech recognition requires an internet connection.\n\n' +
                'Would you like to type your note manually instead?'
            );
            
            if (shouldType) {
                elements.noteTextArea.focus();
            }
            return;
        }
        
        // Initialize recognition if needed
        if (!recognition) {
            recognition = initSpeechRecognition();
        }
        
        if (!recognition) {
            showStatus('⚠️ Failed to initialize speech recognition', true);
            return;
        }
        
        // Set language
        const languageMap = {
            'en': 'en-US',
            'hi': 'hi-IN',
            'bn': 'bn-IN',
            'ta': 'ta-IN',
            'te': 'te-IN',
            'ml': 'ml-IN',
            'kn': 'kn-IN',
            'mr': 'mr-IN',
            'gu': 'gu-IN',
            'pa': 'pa-IN',
            'ur': 'ur-PK'
        };
        recognition.lang = languageMap[currentLanguage] || 'en-US';
        
        // Show live transcription display
        elements.liveTranscription.classList.add('active');
        elements.liveTranscriptionText.innerHTML = '<span class="interim">🔌 Connecting to speech service...</span>';
        
        // Start recognition
        recognition.start();
        
        isRecording = true;
        elements.recordBtn.classList.add('recording');
        elements.recordBtn.textContent = '⏹️';
        showStatus(`🎙️ Recording in ${getLanguageName(currentLanguage)}... (online mode)`);
        
    } catch (error) {
        console.error('Recording error:', error);
        showStatus('❌ Failed to start recording: ' + error.message, true);
        
        // Fallback to manual input
        if (confirm('Speech recognition failed. Would you like to type instead?')) {
            elements.noteTextArea.focus();
        }
    }
}

function stopRecording() {
    if (recognition && isRecording) {
        try {
            recognition.stop();
        } catch (error) {
            console.error('Error stopping recognition:', error);
        }
        
        isRecording = false;
        elements.recordBtn.classList.remove('recording');
        elements.recordBtn.textContent = '🎤';
        
        // Hide live transcription display
        elements.liveTranscription.classList.remove('active');
        
        if (finalTranscript && finalTranscript.trim().length > 0) {
            showStatus('✅ Transcription saved!');
            finalTranscript = ''; // Reset for next recording
        } else {
            showStatus('Recording stopped');
        }
    }
}

// ========================================
// Network Status Monitoring
// ========================================

window.addEventListener('online', () => {
    console.log('🌐 Network: Online');
    networkStatus = 'online';
    updateNetworkStatus();
    showStatus('✅ Internet connection restored. Speech recognition available.');
});

window.addEventListener('offline', () => {
    console.log('📵 Network: Offline');
    networkStatus = 'offline';
    updateNetworkStatus();
    showStatus('📵 No internet. Speech recognition disabled. You can still type notes.', true);
    
    // Stop recording if active
    if (isRecording) {
        stopRecording();
    }
});

// ========================================
// AI Summarization (Mock Implementation)
// ========================================

async function summarizeNote() {
    if (!currentNote || !currentNote.text || currentNote.text.trim().length === 0) {
        showStatus('⚠️ No text to summarize', true);
        return;
    }
    
    showLoading('✨ Generating AI summary...');
    
    // Simulate AI processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Mock summary based on text length
    const wordCount = currentNote.text.split(/\s+/).length;
    const mockSummary = `📝 Summary (${wordCount} words): This note contains information about ${currentLanguage === 'en' ? 'various topics' : 'विभिन्न विषयों'}. ${
        wordCount > 50 
            ? 'The content is detailed and covers multiple points.' 
            : 'This is a brief note with key information.'
    } In production, this would use Transformers.js (Xenova/mt5-small) to generate real AI summaries locally in your browser, supporting ${getLanguageName(currentLanguage)} and other Indian languages.`;
    
    currentNote.summary = mockSummary;
    elements.summarySection.style.display = 'block';
    elements.summaryText.textContent = mockSummary;
    
    await autoSave();
    hideLoading();
    showStatus('✅ Summary generated!');
}

// ========================================
// Export Functionality
// ========================================

async function exportNotes() {
    try {
        const notes = await getAllNotes();
        
        if (notes.length === 0) {
            showStatus('⚠️ No notes to export', true);
            return;
        }
        
        const dataStr = JSON.stringify(notes, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `voicenotes-export-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        showStatus(`✅ Exported ${notes.length} notes successfully!`);
    } catch (error) {
        console.error('Export error:', error);
        showStatus('❌ Export failed', true);
    }
}

// ========================================
// Theme Toggle
// ========================================

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    elements.themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('theme', newTheme);
    
    showStatus(`${newTheme === 'dark' ? '🌙' : '☀️'} ${newTheme === 'dark' ? 'Dark' : 'Light'} mode enabled`);
}

// ========================================
// Event Listeners
// ========================================

elements.newNoteBtn.addEventListener('click', createNewNote);

elements.noteTitleInput.addEventListener('input', scheduleAutoSave);
elements.noteTextArea.addEventListener('input', scheduleAutoSave);

elements.recordBtn.addEventListener('click', () => {
    if (!currentNote) createNewNote();
    isRecording ? stopRecording() : startRecording();
});

elements.summarizeBtn.addEventListener('click', summarizeNote);
elements.exportBtn.addEventListener('click', exportNotes);

elements.languageSelect.addEventListener('change', (e) => {
    currentLanguage = e.target.value;
    if (currentNote) {
        currentNote.language = currentLanguage;
        updateEditor();
        scheduleAutoSave();
    }
    showStatus(`🌐 Language changed to ${getLanguageName(currentLanguage)}`);
});

elements.themeToggle.addEventListener('click', toggleTheme);

elements.helpBtn.addEventListener('click', () => {
    elements.helpModal.classList.add('active');
});

elements.closeHelpBtn.addEventListener('click', () => {
    elements.helpModal.classList.remove('active');
});

elements.closeHelpBtn2.addEventListener('click', () => {
    elements.helpModal.classList.remove('active');
});

elements.helpModal.addEventListener('click', (e) => {
    if (e.target === elements.helpModal) {
        elements.helpModal.classList.remove('active');
    }
});

elements.notesList.addEventListener('click', async (e) => {
    const noteItem = e.target.closest('.note-item');
    if (noteItem) {
        const noteId = parseInt(noteItem.dataset.noteId);
        currentNote = await getNote(noteId);
        updateEditor();
        await loadNotes();
    }
});

elements.searchInput.addEventListener('input', async (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const notes = await getAllNotes();
    
    if (searchTerm) {
        const filtered = notes.filter(note => 
            (note.title || '').toLowerCase().includes(searchTerm) ||
            (note.text || '').toLowerCase().includes(searchTerm)
        );
        renderNotesList(filtered);
    } else {
        renderNotesList(notes);
    }
});

// ========================================
// Keyboard Shortcuts
// ========================================

document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + N: New note
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        createNewNote();
        showStatus('📝 New note created');
    }
    
    // Ctrl/Cmd + S: Manual save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        autoSave();
    }
    
    // Ctrl/Cmd + E: Export
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportNotes();
    }
    
    // Ctrl/Cmd + R: Toggle recording
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        if (!currentNote) createNewNote();
        isRecording ? stopRecording() : startRecording();
    }
    
    // Escape: Stop recording
    if (e.key === 'Escape' && isRecording) {
        e.preventDefault();
        stopRecording();
    }
});

// ========================================
// Initialization
// ========================================

async function initialize() {
    try {
        console.log('🚀 Initializing VoiceNotes...');
        
        // Initialize IndexedDB
        await initDB();
        console.log('✅ Database initialized');
        
        // Load saved theme
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
            elements.themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
        }
        
        // Check network status
        updateNetworkStatus();
        
        // Load notes
        await loadNotes();
        console.log('✅ Notes loaded');
        
        // Create first note if none exist
        const notes = await getAllNotes();
        if (notes.length === 0) {
            createNewNote();
            console.log('📝 Created first note');
        } else {
            currentNote = notes[0];
            updateEditor();
        }
        
        // Show welcome message with network status
        const onlineStatus = checkInternetConnection() ? 'online' : 'offline';
        console.log(`✅ VoiceNotes initialized successfully (${onlineStatus})`);
        
        if (!checkInternetConnection()) {
            showStatus('📵 Offline mode: Type notes manually. Speech requires internet.', false);
        } else {
            showStatus('✅ Ready! Click 🎙️ to record or start typing.', false);
        }
        
    } catch (error) {
        console.error('❌ Initialization error:', error);
        showStatus('⚠️ Initialization failed. Please refresh the page.', true);
    }
}

// Start the application
initialize();

// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(registration => {
            console.log('✅ Service Worker registered:', registration.scope);
        })
        .catch(error => {
            console.log('⚠️ Service Worker registration failed:', error);
        });
}
