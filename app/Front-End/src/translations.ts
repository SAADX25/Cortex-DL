
export type Language = 'ar' | 'en';

export interface Translations {
  nav_add: string;
  nav_downloads: string;
  nav_settings: string;
  add_title: string;
  add_subtitle: string;
  url_placeholder: string;
  analyze_btn: string;
  analyzing: string;
  format_label: string;
  video_mp4: string;
  audio_mp3: string;
  quality_label: string;
  quality_best: string;
  save_to: string;
  choose_folder: string;
  cookies_label: string;
  cookies_none: string;
  cookies_note: string;
  start_download: string;
  downloads_title: string;
  total_tasks: string;
  search_placeholder: string;
  resume_all: string;
  pause_all: string;
  clear_completed: string;
  empty_title: string;
  empty_subtitle: string;
  empty_btn: string;
  status_queued: string;
  status_downloading: string;
  status_merging: string;
  status_converting: string;
  merging: string;
  converting: string;
  trimming: string;
  finalizing: string;
  accelerating: string;
  status_paused: string;
  status_completed: string;
  status_error: string;
  status_canceled: string;
  btn_pause: string;
  btn_resume: string;
  btn_cancel: string;
  btn_play: string;
  btn_folder: string;
  btn_remove: string;
  btn_delete: string;
  settings_title: string;
  settings_subtitle: string;
  general_group: string;
  notifications_title: string;
  notifications_desc: string;
  concurrent_title: string;
  concurrent_desc: string;
  about_group: string;
  version: string;
  powered_by: string;
  description: string;
  developer: string;
  language_label: string;
  confirm_delete_all: string;
  confirm_remove_only: string;
  error_occurred: string;
  folder_pick_failed: string;
  analyze_failed: string;
  download_start_failed: string;
  pause_failed: string;
  resume_failed: string;
  cancel_failed: string;
  delete_failed: string;
  clear_failed: string;
  pause_all_failed: string;
  resume_all_failed: string;
  open_file_failed: string;
  open_folder_failed: string;
  speed_unit: string;
  quality_placeholder: string;
  quality_4k: string;
  quality_2k: string;
  quality_1080p: string;
  quality_720p: string;
  quality_480p: string;
  quality_360p: string;
  quality_240p: string;
  auth_group: string;
  cookies_section_title: string;
  cookies_section_desc: string;
  select_cookies_file: string;
  browser_load_cookies: string;
  advanced_auth_title: string;
  basic_auth_label: string;
  username_label: string;
  password_label: string;
  show_password: string;
  hide_password: string;
  update_engine_btn: string;
  updating_engine: string;
  engine_updated: string;
  engine_update_failed: string;
  playlist_title: string;
  download_all: string;
  items_count: string;
  total_downloaded: string;
  check_for_updates: string;
  checking_updates: string;
  update_available: string;
  update_not_available: string;
  update_downloaded: string;
  update_error: string;
  reset_stats: string;
  confirm_reset_stats: string;
  browse_sites: string;
  modal_confirm: string;
  modal_cancel: string;
  msg_delete_file_confirm: string;
  msg_remove_list_confirm: string;
  msg_clear_completed_confirm: string;
  settings_general: string;
  settings_current_version: string;
  settings_about: string;
  settings_developed_by: string;
  settings_powered_by: string;
  settings_danger_zone: string;
  settings_uninstall_title: string;
  settings_uninstall_desc: string;
  settings_uninstall_btn: string;
  settings_modal_title: string;
  settings_modal_desc: string;
  settings_confirm_uninstall: string;
  settings_cancel: string;
  use_inapp_player: string;
  use_inapp_player_desc: string;
  paste_and_go: string;
  btn_video: string;
  btn_audio: string;
  new_folder_placeholder: string;
  speed_auto: string;
}

export const defaultLanguage: Language = 'en';

export const translations: Record<Language, Translations> = {
  ar: {
    nav_add: "إضافة رابط",
    nav_downloads: "التنزيلات",
    nav_settings: "الإعدادات",
    add_title: "إضافة تنزيل جديد",
    add_subtitle: "أدخل رابط الفيديو أو الصوت من يوتيوب، فيسبوك، أو إنستغرام",
    url_placeholder: "الصق رابط أي فيديو أو مقطع صوتي هنا...",
    analyze_btn: "تحليل الرابط",
    analyzing: "جاري التحليل...",
    format_label: "صيغة الملف",
    video_mp4: "🎬 فيديو MP4",
    audio_mp3: "🎵 صوت MP3",
    quality_label: "الجودة المتاحة",
    quality_best: "أفضل جودة تلقائياً",
    save_to: "حفظ في",
    choose_folder: "اختر مجلد الحفظ...",
    cookies_label: "سحب الكوكيز (اختياري)",
    cookies_none: "بدون (تنزيل عادي)",
    cookies_note: "💡 ملاحظة: لبعض روابط يوتيوب قد يلزم كوكيز (تسجيل دخول/كابتشا). يمكنك اختيار متصفحك (يجب إغلاق المتصفح أثناء التحليل/التنزيل).",
    start_download: "🚀 بدء التنزيل الآن",
    downloads_title: "قائمة التنزيلات",
    total_tasks: "إجمالي المهام",
    search_placeholder: "بحث في التنزيلات...",
    resume_all: "▶ استئناف الكل",
    pause_all: "⏸ إيقاف الكل",
    clear_completed: "🧹 مسح المكتمل",
    empty_title: "لا توجد مهام حالياً",
    empty_subtitle: "ابدأ بإضافة روابط جديدة من قسم \"إضافة رابط\"",
    empty_btn: "إضافة رابط",
    status_queued: "في الانتظار",
    status_downloading: "جارٍ التنزيل",
    status_merging: "جاري دمج الصوت والصورة...",
    status_converting: "جاري تحويل الصيغة...",
    merging: "جاري الدمج...",
    converting: "جاري التحويل...",
    trimming: "جاري القص...",
    finalizing: "جاري الإنهاء...",
    accelerating: "تسريع التحميل...",
    status_paused: "متوقف مؤقتًا",
    status_completed: "مكتمل",
    status_error: "خطأ",
    status_canceled: "ملغي",
    btn_pause: "⏸ إيقاف",
    btn_resume: "▶ استئناف",
    btn_cancel: "✕ إلغاء",
    btn_play: "▶ تشغيل",
    btn_folder: "📂 المجلد",
    btn_remove: "✕ إزالة",
    btn_delete: "🗑️ حذف الملف",
    settings_title: "الإعدادات",
    settings_subtitle: "تخصيص تجربة التطبيق",
    general_group: "عام",
    notifications_title: "إشعارات النظام",
    notifications_desc: "تنبيهك عند اكتمال التحميل أو حدوث خطأ",
    concurrent_title: "عدد التحميلات المتزامنة",
    concurrent_desc: "الحد الأقصى للملفات التي يتم تحميلها في وقت واحد",
    about_group: "عن التطبيق",
    version: "إصدار",
    powered_by: "مدعوم بواسطة",
    description: "تم التطوير لتوفير أفضل تجربة تنزيل فيديو وصوت.",
    developer: "تم تطوير برنامج من قبل SAADX25",
    language_label: "اللغة / Language",
    confirm_delete_all: "هل أنت متأكد من حذف المهمة والملف نهائياً من جهازك؟",
    confirm_remove_only: "هل تريد إزالة المهمة من القائمة فقط؟",
    error_occurred: "حدث خطأ",
    folder_pick_failed: "فشل اختيار المجلد",
    analyze_failed: "فشل تحليل الرابط",
    download_start_failed: "فشل بدء التنزيل",
    pause_failed: "فشل الإيقاف المؤقت",
    resume_failed: "فشل الاستكمال",
    cancel_failed: "فشل الإلغاء",
    delete_failed: "فشل الحذف",
    clear_failed: "فشل مسح المهام",
    pause_all_failed: "فشل إيقاف الكل",
    resume_all_failed: "فشل استئناف الكل",
    open_file_failed: "فشل فتح الملف",
    open_folder_failed: "فشل فتح المجلد",
    speed_unit: "ث",
    quality_placeholder: "جودة",
    quality_4k: "4K (2160p) - فائق الدقة",
    quality_2k: "2K (1440p) - عالي الدقة",
    quality_1080p: "Full HD (1080p)",
    quality_720p: "HD (720p)",
    quality_480p: "SD (480p)",
    quality_360p: "منخفضة (360p)",
    quality_240p: "منخفضة جداً (240p)",
    auth_group: "المصادقة (Authentication)",
    cookies_section_title: "الكوكيز (موصى به)",
    cookies_section_desc: "استخدام الكوكيز لتجاوز قيود المواقع وتحميل المحتوى الخاص.",
    select_cookies_file: "اختر ملف cookies.txt",
    browser_load_cookies: "تحميل الكوكيز تلقائياً من المتصفح",
    advanced_auth_title: "طرق متقدمة (Advanced)",
    basic_auth_label: "المصادقة الأساسية (Basic Auth)",
    username_label: "اسم المستخدم",
    password_label: "كلمة المرور",
    show_password: "إظهار",
    hide_password: "إخفاء",
    update_engine_btn: "تحديث محرك التنزيل",
    updating_engine: "جاري التحديث...",
    engine_updated: "تم تحديث المحرك بنجاح!",
    engine_update_failed: "فشل تحديث المحرك",
    playlist_title: "قائمة تشغيل (Playlist)",
    download_all: "تنزيل الكل",
    items_count: "فيديو",
    total_downloaded: "إجمالي البيانات المحملة",
    check_for_updates: "التحقق من التحديثات",
    checking_updates: "جاري التحقق...",
    update_available: "يوجد تحديث! جاري التحميل...",
    update_not_available: "أنت على آخر إصدار",
    update_downloaded: "إعادة التشغيل والتثبيت",
    update_error: "فشل التحديث",
    reset_stats: "تصفير العداد",
    confirm_reset_stats: "هل أنت متأكد أنك تريد تصفير عداد البيانات؟",
    browse_sites: "تصفح المواقع",
    modal_confirm: "تأكيد",
    modal_cancel: "إلغاء",
    msg_delete_file_confirm: "هل أنت متأكد أنك تريد حذف هذا الملف نهائياً؟ هذا الإجراء لا يمكن التراجع عنه.",
    msg_remove_list_confirm: "هل تريد إزالة هذه المهمة من القائمة فقط؟",
    msg_clear_completed_confirm: "هل تريد مسح جميع التنزيلات المكتملة من القائمة؟",
    settings_general: "عام",
    settings_current_version: "الإصدار الحالي: ",
    settings_about: "عن التطبيق",
    settings_developed_by: "تطوير",
    settings_powered_by: "مشغل بواسطة",
    settings_danger_zone: "منطقة الخطر",
    settings_uninstall_title: "حذف البرنامج",
    settings_uninstall_desc: "حذف التطبيق وكافة ملفاته نهائياً من الجهاز",
    settings_uninstall_btn: "حذف / تهيئة",
    settings_modal_title: "حذف Cortex DL",
    settings_modal_desc: "هل أنت متأكد؟ سيتم إغلاق البرنامج وتشغيل معالج الحذف لإزالة التثبيت.",
    settings_confirm_uninstall: "تأكيد الحذف",
    settings_cancel: "إلغاء",
    use_inapp_player: "مشغل وسائط مدمج",
    use_inapp_player_desc: "تشغيل الفيديو والصوت داخل التطبيق بدلاً من المشغل الافتراضي",
    paste_and_go: "لصق وانطلاق",
    btn_video: "فيديو",
    btn_audio: "صوت",
    new_folder_placeholder: "مجلد جديد (اختياري)",
    speed_auto: "تلقائي",
  },
  en: {
    nav_add: "Add Link",
    nav_downloads: "Downloads",
    nav_settings: "Settings",
    add_title: "Add New Download",
    add_subtitle: "Enter video or audio link from YouTube, Facebook, or Instagram",
    url_placeholder: "Drop any video or audio link here...",
    analyze_btn: "Analyze Link",
    analyzing: "Analyzing...",
    format_label: "File Format",
    video_mp4: "🎬 Video MP4",
    audio_mp3: "🎵 Audio MP3",
    quality_label: "Available Quality",
    quality_best: "Best Quality Auto",
    save_to: "Save To",
    choose_folder: "Choose download folder...",
    cookies_label: "Import Cookies (Optional)",
    cookies_none: "None (Normal Download)",
    cookies_note: "💡 Note: Some YouTube links require cookies (login/CAPTCHA). You can select a browser (must be closed during analyze/download).",
    start_download: "🚀 Start Download Now",
    downloads_title: "Download List",
    total_tasks: "Total Tasks",
    search_placeholder: "Search downloads...",
    resume_all: "▶ Resume All",
    pause_all: "⏸ Pause All",
    clear_completed: "🧹 Clear Completed",
    empty_title: "No tasks currently",
    empty_subtitle: "Start by adding new links from the 'Add Link' section",
    empty_btn: "Add Link",
    status_queued: "Queued",
    status_downloading: "Downloading",
    status_merging: "Merging Audio & Video...",
    status_converting: "Converting Format...",
    merging: "Merging...",
    converting: "Converting...",
    trimming: "Trimming...",
    finalizing: "Finalizing...",
    accelerating: "Accelerating...",
    status_paused: "Paused",
    status_completed: "Completed",
    status_error: "Error",
    status_canceled: "Canceled",
    btn_pause: "⏸ Pause",
    btn_resume: "▶ Resume",
    btn_cancel: "✕ Cancel",
    btn_play: "▶ Play",
    btn_folder: "📂 Folder",
    btn_remove: "✕ Remove",
    btn_delete: "🗑️ Delete File",
    settings_title: "Settings",
    settings_subtitle: "Customize App Experience",
    general_group: "General",
    notifications_title: "System Notifications",
    notifications_desc: "Notify you when download completes or error occurs",
    concurrent_title: "Concurrent Downloads",
    concurrent_desc: "Maximum files to download at the same time",
    about_group: "About App",
    version: "Version",
    powered_by: "Powered by",
    description: "Developed to provide the best video and audio download experience.",
    developer: "Developed by - SAADX25",
    language_label: "Language / اللغة",
    confirm_delete_all: "Are you sure you want to delete the task and file permanently from your device?",
    confirm_remove_only: "Do you want to remove the task from the list only?",
    error_occurred: "An error occurred",
    folder_pick_failed: "Failed to pick folder",
    analyze_failed: "Failed to analyze link",
    download_start_failed: "Failed to start download",
    pause_failed: "Failed to pause",
    resume_failed: "Failed to resume",
    cancel_failed: "Failed to cancel",
    delete_failed: "Failed to delete",
    clear_failed: "Failed to clear tasks",
    pause_all_failed: "Failed to pause all",
    resume_all_failed: "Failed to resume all",
    open_file_failed: "Failed to open file",
    open_folder_failed: "Failed to open folder",
    speed_unit: "s",
    quality_placeholder: "Quality",
    quality_4k: "4K (2160p)",
    quality_2k: "2K (1440p)",
    quality_1080p: "Full HD (1080p)",
    quality_720p: "HD (720p)",
    quality_480p: "SD (480p)",
    quality_360p: "Low (360p)",
    quality_240p: "Very Low (240p)",
    auth_group: "Authentication",
    cookies_section_title: "Cookies (Recommended)",
    cookies_section_desc: "Use cookies to bypass site restrictions and download private content.",
    select_cookies_file: "Select cookies.txt file",
    browser_load_cookies: "Automatically load cookies from a browser",
    advanced_auth_title: "Advanced Methods",
    basic_auth_label: "Basic Auth",
    username_label: "Username",
    password_label: "Password",
    show_password: "Show",
    hide_password: "Hide",
    update_engine_btn: "Update Engine",
    updating_engine: "Updating Engine...",
    engine_updated: "Engine Updated Successfully!",
    engine_update_failed: "Engine Update Failed",
    playlist_title: "Playlist",
    download_all: "Download All",
    items_count: "Videos",
    total_downloaded: "Total Data Downloaded",
    check_for_updates: "Check for Updates",
    checking_updates: "Checking...",
    update_available: "Update found! Downloading...",
    update_not_available: "You are up to date",
    update_downloaded: "Restart & Install",
    update_error: "Update Failed",
    reset_stats: "Reset Counter",
    confirm_reset_stats: "Are you sure you want to reset the data counter?",
    browse_sites: "Browse Sites",
    modal_confirm: "Confirm",
    modal_cancel: "Cancel",
    msg_delete_file_confirm: "Are you sure you want to permanently delete this file? This cannot be undone.",
    msg_remove_list_confirm: "Remove this task from the list?",
    msg_clear_completed_confirm: "Clear all completed downloads from the list?",
    settings_general: "General",
    settings_current_version: "Current: ",
    settings_about: "About App",
    settings_developed_by: "Developed by",
    settings_powered_by: "Powered by",
    settings_danger_zone: "DANGER ZONE",
    settings_uninstall_title: "Uninstall Cortex DL",
    settings_uninstall_desc: "Remove the app and all its components",
    settings_uninstall_btn: "Uninstall / Reset",
    settings_modal_title: "Uninstall Cortex DL",
    settings_modal_desc: "Are you sure you want to uninstall? This will close the app and launch the uninstaller.",
    settings_confirm_uninstall: "Uninstall",
    settings_cancel: "Cancel",
    use_inapp_player: "In-App Media Player",
    use_inapp_player_desc: "Play videos and audio inside the app instead of system default",
    paste_and_go: "Paste & Go",
    btn_video: "Video",
    btn_audio: "Audio",
    new_folder_placeholder: "New Folder (Optional)",
    speed_auto: "Auto",
  }
};
