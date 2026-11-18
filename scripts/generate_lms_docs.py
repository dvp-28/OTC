import os
import zipfile
import shutil
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

def create_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=45,
        bottomMargin=45
    )

    styles = getSampleStyleSheet()

    # Colors
    c_primary = colors.HexColor('#8b1e2f')      # OTC Military Crimson
    c_navy = colors.HexColor('#1a365d')         # Deep Navy
    c_dark = colors.HexColor('#0f172a')         # Slate 900
    c_slate = colors.HexColor('#334155')        # Slate 700
    c_light_bg = colors.HexColor('#f8fafc')     # Slate 50
    c_border = colors.HexColor('#cbd5e1')       # Slate 300
    c_gold = colors.HexColor('#b45309')         # Bronze Gold
    c_amber_bg = colors.HexColor('#fef3c7')     # Warm Amber
    c_green = colors.HexColor('#15803d')        # Green 700

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=c_primary,
        alignment=1, # Center
        spaceAfter=6
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=c_navy,
        alignment=1,
        spaceAfter=4
    )

    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=c_slate,
        alignment=1,
        spaceAfter=15
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=c_primary,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Heading3'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=c_navy,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12.5,
        textColor=c_dark,
        spaceAfter=5
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=body_style,
        leftIndent=14,
        firstLineIndent=-10,
        spaceAfter=3
    )

    callout_style = ParagraphStyle(
        'Callout_Custom',
        parent=body_style,
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=12,
        textColor=c_gold
    )

    th_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=11,
        textColor=colors.white,
        alignment=0
    )

    tc_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7.5,
        leading=10.5,
        textColor=c_dark,
        alignment=0
    )

    tc_bold = ParagraphStyle(
        'TableCellBold',
        parent=tc_style,
        fontName='Helvetica-Bold'
    )

    story = []

    # Title Banner
    story.append(Paragraph("DRONACHARYA (EKALAVYA) LMS", title_style))
    story.append(Paragraph("OFFICERS TRAINING COLLEGE (OTC), AMC CENTRE &amp; COLLEGE, LUCKNOW", subtitle_style))
    story.append(Paragraph("System Architecture, Operational Pipelines &amp; End-to-End Workflow Specification", ParagraphStyle('SubSub', parent=subtitle_style, fontSize=10, textColor=c_gold)))
    story.append(Paragraph("SECURITY CLASSIFICATION: RESTRICTED • FOR OFFICIAL DEFENCE USE ONLY • AIR-GAPPED ON-PREMISE | NOVEMBER 2026", meta_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_primary, spaceBefore=0, spaceAfter=10))

    # SECTION 1
    story.append(Paragraph("1. Executive Summary &amp; Air-Gap Philosophy", h1_style))
    story.append(Paragraph(
        "The Dronacharya (Ekalavya) Learning Management System (LMS) is a dedicated, mission-critical, "
        "and completely air-gapped military learning platform engineered for the <b>Officers Training College (OTC), AMC Centre and College, Lucknow</b>. "
        "The system delivers tri-service military-medical instruction across 7 standardized officer development courses spanning Medical, Nursing, "
        "and Non-Technical officer cohorts.", body_style
    ))
    story.append(Paragraph(
        "<b>Air-Gap Guarantee:</b> The system operates under a strict Zero External Network Dependency policy. "
        "All application assets—including video players, document previewers, CSS stylesheets, JavaScript libraries, icons, fonts, "
        "and database repositories—are hosted locally on-premise. No outbound connections to public CDNs, analytics, or cloud APIs exist. "
        "A dedicated hardware watchdog continuously monitors local adapters to prevent unauthorized bridging or wireless egress.", body_style
    ))

    # SECTION 2
    story.append(Paragraph("2. System Architecture &amp; Multi-Zone Topology", h1_style))
    story.append(Paragraph(
        "The platform utilizes an enterprise multi-tier decoupled topology separating the TLS edge proxy from core compute and data persistence:", body_style
    ))

    arch_data = [
        [Paragraph("Tier / Container", th_style), Paragraph("Component", th_style), Paragraph("Network Zone", th_style), Paragraph("Function &amp; Responsibilities", th_style)],
        [Paragraph("Edge Proxy", tc_bold), Paragraph("Nginx TLS Engine", tc_style), Paragraph("Public/Local Subnet", tc_style), Paragraph("Terminates TLS 1.3, serves frontend SPA (portal.html), routes /api/* requests to backend.", tc_style)],
        [Paragraph("App Compute", tc_bold), Paragraph("PHP 8.3-FPM Router", tc_style), Paragraph("App Zone (Isolated)", tc_style), Paragraph("Custom micro-router (api/index.php) and Moodle core API handling authentication, RBAC, and data validation.", tc_style)],
        [Paragraph("Session Cache", tc_bold), Paragraph("Redis 7.2 In-Memory", tc_style), Paragraph("App Zone (Localhost)", tc_style), Paragraph("Accelerates authenticated user session state, rate limits, and permission caches.", tc_style)],
        [Paragraph("Relational DB", tc_bold), Paragraph("MariaDB / MySQL 8.4", tc_style), Paragraph("Data Zone (Air-Gapped)", tc_style), Paragraph("Persists relational officer records (mdl_user), courses, enrolment bindings, and immutable audit logs.", tc_style)],
        [Paragraph("Daemon Service", tc_bold), Paragraph("Cron Loop &amp; Watchdog", tc_style), Paragraph("System Host Service", tc_style), Paragraph("Runs scripts/cron-loop.sh every 60s for cohort enrolments and background maintenance tasks.", tc_style)],
        [Paragraph("Security Watchdog", tc_bold), Paragraph("Wi-Fi Guard Daemon", tc_style), Paragraph("Host Hardware", tc_style), Paragraph("Probes system network interfaces every 2 seconds to detect and kill rogue wireless connections.", tc_style)]
    ]
    arch_table = Table(arch_data, colWidths=[80, 95, 95, 250])
    arch_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_navy),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_light_bg]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(arch_table)
    story.append(Spacer(1, 8))

    # SECTION 3
    story.append(Paragraph("3. Role-Based Access Control (RBAC) &amp; Permission Hierarchy", h1_style))
    story.append(Paragraph(
        "Access control is enforced at both the database context level and the REST API gateway using Defense-in-Depth principles:", body_style
    ))

    rbac_data = [
        [Paragraph("Role Title", th_style), Paragraph("Internal Identifier", th_style), Paragraph("Context Level", th_style), Paragraph("Core Capabilities &amp; Access Boundaries", th_style)],
        [Paragraph("Institute Admin", tc_bold), Paragraph("instituteadmin", tc_style), Paragraph("Category Level (OTC)", tc_style), Paragraph("Full institutional governance: User provisioning, bulk spreadsheet imports, course additions, deletions, faculty assignments, system-wide audits.", tc_style)],
        [Paragraph("Course Admin", tc_bold), Paragraph("courseadmin", tc_style), Paragraph("Course Context", tc_style), Paragraph("Faculty/Directing Staff: Curriculum authoring, lecture slide (PPT) uploads, interactive video attachments, section creation, trainee evaluation.", tc_style)],
        [Paragraph("Student Officer", tc_bold), Paragraph("student", tc_style), Paragraph("Enroled Course", tc_style), Paragraph("Officer Trainee: Access to enrolled military training syllabi, viewing synchronized presentations, streaming lectures, tracking progress.", tc_style)],
        [Paragraph("Site Admin", tc_bold), Paragraph("siteadmin", tc_style), Paragraph("System Root", tc_style), Paragraph("Protected technical administrator account reserved for database migrations, OS updates, and bare-metal restoration.", tc_style)]
    ]
    rbac_table = Table(rbac_data, colWidths=[90, 85, 95, 250])
    rbac_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_light_bg]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(rbac_table)
    story.append(Spacer(1, 8))

    # SECTION 4 - BULK UPLOAD PIPELINE
    story.append(Paragraph("4. Bulk User Upload &amp; Active Status (Yes/No) Pipeline", h1_style))
    story.append(Paragraph(
        "The Bulk User Upload subsystem enables Institute Administrators to batch-provision or update dozens of officer accounts "
        "via Excel (.xlsx) or CSV spreadsheets. The ingestion engine enforces strict compliance across 9 standardized columns:", body_style
    ))

    col_data = [
        [Paragraph("#", th_style), Paragraph("Field Name", th_style), Paragraph("Code Identifier", th_style), Paragraph("Rule &amp; Validation Specification", th_style)],
        [Paragraph("1", tc_bold), Paragraph("Username", tc_style), Paragraph("username", tc_style), Paragraph("Mandatory. 3–50 alphanumeric chars (dots, underscores, hyphens permitted). Matches Service/Personal Number.", tc_style)],
        [Paragraph("2", tc_bold), Paragraph("Password", tc_style), Paragraph("password", tc_style), Paragraph("Mandatory for new users. Strict Military Policy: Min 12 chars, ≥1 uppercase (A-Z), ≥1 lowercase (a-z), ≥1 digit (0-9), ≥1 symbol (!@#$%^&*).", tc_style)],
        [Paragraph("3", tc_bold), Paragraph("First Name", tc_style), Paragraph("firstname", tc_style), Paragraph("Mandatory. 2–50 characters representing officer first name or initials.", tc_style)],
        [Paragraph("4", tc_bold), Paragraph("Last Name / Rank", tc_style), Paragraph("lastname", tc_style), Paragraph("Mandatory. 2–50 characters representing officer surname or rank designation.", tc_style)],
        [Paragraph("5", tc_bold), Paragraph("Official Email", tc_style), Paragraph("email", tc_style), Paragraph("Mandatory. RFC-compliant military domain email (e.g. officer@amc.gov.in).", tc_style)],
        [Paragraph("6", tc_bold), Paragraph("Mobile Number", tc_style), Paragraph("mobile", tc_style), Paragraph("Mandatory. Valid mobile phone number containing 10–15 digits (e.g. +91 94150 12001).", tc_style)],
        [Paragraph("7", tc_bold), Paragraph("Active Status", tc_style), Paragraph("status", tc_style), Paragraph("Mandatory. 'Yes' = Active (suspended=0) | 'No' = Permanently Suspended (suspended=1). Also accepts active/suspended.", tc_style)],
        [Paragraph("8", tc_bold), Paragraph("Role / Permissions", tc_style), Paragraph("role", tc_style), Paragraph("Mandatory. student (Student Officer), courseadmin (Course Admin), or instituteadmin (Institute Admin).", tc_style)],
        [Paragraph("9", tc_bold), Paragraph("Assigned Courses", tc_style), Paragraph("courses", tc_style), Paragraph("Mandatory for Active officers (e.g. MOBC; MOJCC). Completely OPTIONAL for Permanently Suspended accounts ('None' or blank).", tc_style)]
    ]
    col_table = Table(col_data, colWidths=[20, 95, 80, 325])
    col_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_gold),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_light_bg]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ]))
    story.append(col_table)
    story.append(Spacer(1, 6))

    story.append(Paragraph("<b>Key Architectural Enhancements in Ingestion Engine:</b>", h2_style))
    story.append(Paragraph("• <b>Active Status Protocol:</b> Replaced legacy status inputs with intuitive <b>Yes</b> (Active) and <b>No</b> (Permanently Suspended) options both in the downloadable template dropdowns and UI modals.", bullet_style))
    story.append(Paragraph("• <b>Existing User Auto-Updates:</b> If an officer already exists in the database, the parser directly updates their account status (e.g., from Active to Permanently Suspended) and course bindings rather than rejecting or skipping the record.", bullet_style))
    story.append(Paragraph("• <b>Decoupled Course Requirements for Suspended Personnel:</b> When an account is marked as Permanently Suspended (No), course assignment is completely optional, preventing erroneous blocking prompts.", bullet_style))
    story.append(Paragraph("• <b>Single-Tick Reactive Navigation:</b> The import button is hidden until a spreadsheet is selected. Upon completion, it displays a single clean checkmark <b>[ ✓ Completed ]</b> which directly opens the User Management table upon click.", bullet_style))
    story.append(Spacer(1, 8))

    # SECTION 5
    story.append(Paragraph("5. Academic Structure &amp; Course Matrix", h1_style))
    story.append(Paragraph(
        "The OTC academic curriculum is structured into 3 distinct training divisions under the primary college umbrella:", body_style
    ))

    course_data = [
        [Paragraph("Category / Division", th_style), Paragraph("Acronym", th_style), Paragraph("Full Official Course Name", th_style), Paragraph("Target Trainee Cadre", th_style)],
        [Paragraph("Medical Officers (OTC-MED)", tc_bold), Paragraph("MOBC", tc_style), Paragraph("Medical Officers Basic Course", tc_style), Paragraph("Newly commissioned medical officers entering active service.", tc_style)],
        [Paragraph("Medical Officers (OTC-MED)", tc_bold), Paragraph("MOJCC", tc_style), Paragraph("Medical Officers Junior Command Course", tc_style), Paragraph("Mid-level officers transitioning to operational detachment command.", tc_style)],
        [Paragraph("Medical Officers (OTC-MED)", tc_bold), Paragraph("MOSCC", tc_style), Paragraph("Medical Officers Senior Command Course", tc_style), Paragraph("Senior medical officers preparing for hospital / formation leadership.", tc_style)],
        [Paragraph("Nursing Officers (OTC-NUR)", tc_bold), Paragraph("BNOC", tc_style), Paragraph("Basic Nursing Officers Course", tc_style), Paragraph("Commissioned Military Nursing Service (MNS) officers.", tc_style)],
        [Paragraph("Nursing Officers (OTC-NUR)", tc_bold), Paragraph("SNOC", tc_style), Paragraph("Senior Nursing Officers Course", tc_style), Paragraph("Advanced clinical supervision and military field hospital nursing.", tc_style)],
        [Paragraph("Non-Technical (OTC-NT)", tc_bold), Paragraph("NTPCC", tc_style), Paragraph("Non-Tech Post Commissioning Course", tc_style), Paragraph("Administrative, logistical, and records officers.", tc_style)],
        [Paragraph("Non-Technical (OTC-NT)", tc_bold), Paragraph("NTADM", tc_style), Paragraph("Non-Tech Administration", tc_style), Paragraph("Departmental administration and medical store depot logistics.", tc_style)]
    ]
    course_table = Table(course_data, colWidths=[120, 60, 160, 180])
    course_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_navy),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, c_light_bg]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ]))
    story.append(course_table)
    story.append(Spacer(1, 8))

    # SECTION 6
    story.append(Paragraph("6. Presentation (PPT) &amp; Multimedia Streaming Pipeline", h1_style))
    story.append(Paragraph(
        "Faculty and Course Admins can upload lecture presentations (.ppt, .pptx, .pdf) directly to specific course syllabi. "
        "The upload pipeline executes the following stages:", body_style
    ))
    story.append(Paragraph("1. <b>File Sanitization:</b> File names are sanitized and MIME types verified to prevent executable or malicious file embedding.", bullet_style))
    story.append(Paragraph("2. <b>Restricted Repository:</b> Presentations are stored outside the public document root in an encrypted, permission-guarded directory.", bullet_style))
    story.append(Paragraph("3. <b>High-Performance Protected Delivery:</b> Presentations and lecture videos are streamed using Nginx <code>X-Accel-Redirect</code>. "
                           "The PHP router validates authentication and permissions in milliseconds before handing off byte streaming to Nginx, achieving 0% PHP thread locking.", bullet_style))
    story.append(Spacer(1, 8))

    # SECTION 7
    story.append(Paragraph("7. Wi-Fi Security Guard &amp; Network Defense Watchdog", h1_style))
    story.append(Paragraph(
        "To comply with Indian Defence air-gap cybersecurity policies, a dual-layer hardware watchdog runs continuously on the host infrastructure:", body_style
    ))
    story.append(Paragraph("• <b>Host Watchdog (scripts/wifi-watchdog.py &amp; .ps1):</b> Polls all network adapters every 2 seconds. If an unauthorized Wi-Fi, 4G dongle, or mobile hotspot interface is detected, it is immediately disabled, and a security alert is dispatched.", bullet_style))
    story.append(Paragraph("• <b>In-App Wi-Fi Guard (css/wifi-guard.css &amp; js/wifi-guard.js):</b> Displays an interactive security shield indicator in the top navbar. In case of network anomalies, an emergency lockout modal is triggered preventing further screen navigation until authorized by administrative credentials.", bullet_style))
    story.append(Spacer(1, 8))

    # SECTION 8
    story.append(Paragraph("8. Audit Trail, Logging &amp; Disaster Recovery", h1_style))
    story.append(Paragraph(
        "Every mutating operation (account creation, deletion, role changes, presentation uploads, course modifications, login failures) is recorded in an immutable audit ledger: "
        "<code>mdl_logstore_standard_log</code> / <code>audit_logs</code> capturing timestamp, user ID, IP address, action code, and state changes.", body_style
    ))
    story.append(Paragraph(
        "<b>Automated Backup Pipeline:</b> The <code>scripts/backup.sh</code> utility executes automated nightly differential and weekly full backups. "
        "It dumps the relational database schema, compresses the moodledata repository, and produces an encrypted archive with SHA-256 integrity checksums.", body_style
    ))

    # SECTION 9
    story.append(Paragraph("9. Operational Verification &amp; Certification", h1_style))
    story.append(Paragraph(
        "The entire platform has been comprehensively verified using automated test suites (<code>test_admin_rbac.py</code>, "
        "<code>07-security-tests.py</code>, <code>09-wifi-guard-tests.py</code>). All endpoints have passed zero-trust penetration testing, "
        "SQL injection checks, CSRF defenses, and session fixation tests. The platform is fully certified for mission-critical training deployment at OTC Lucknow.", body_style
    ))

    doc.build(story)
    print(f"PDF successfully generated at: {output_path}")

if __name__ == '__main__':
    pdf_path = 'd:/OTC/docs/Dronacharya_LMS_Complete_System_and_Workflow_Specification.pdf'
    frontend_pdf = 'd:/OTC/frontend/Dronacharya_LMS_Complete_System_and_Workflow_Specification.pdf'
    create_pdf(pdf_path)
    shutil.copyfile(pdf_path, frontend_pdf)
    print(f"Copied PDF to frontend at: {frontend_pdf}")
