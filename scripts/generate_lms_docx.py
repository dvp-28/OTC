import os
import zipfile
import shutil
import xml.sax.saxutils as saxutils

def escape_xml(s):
    return saxutils.escape(str(s))

def make_run(text, bold=False, italic=False, color=None, size=None, font='Calibri'):
    rPr = []
    if font:
        rPr.append(f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>')
    if bold:
        rPr.append('<w:b/>')
    if italic:
        rPr.append('<w:i/>')
    if color:
        rPr.append(f'<w:color w:val="{color.lstrip("#")}"/>')
    if size:
        rPr.append(f'<w:sz w:val="{size}"/>')
    rPr_xml = f"<w:rPr>{''.join(rPr)}</w:rPr>" if rPr else ""
    return f"<w:r>{rPr_xml}<w:t xml:space=\"preserve\">{escape_xml(text)}</w:t></w:r>"

def make_para(runs, align='left', space_before=0, space_after=120, bullet=False):
    pPr = []
    if align != 'left':
        pPr.append(f'<w:jc w:val="{align}"/>')
    if space_before or space_after:
        pPr.append(f'<w:spacing w:before="{space_before}" w:after="{space_after}"/>')
    if bullet:
        pPr.append('<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
    pPr_xml = f"<w:pPr>{''.join(pPr)}</w:pPr>" if pPr else ""
    
    if isinstance(runs, str):
        runs = [make_run(runs)]
    return f"<w:p>{pPr_xml}{''.join(runs)}</w:p>"

def make_h1(title):
    return make_para([
        make_run(title, bold=True, color='8B1E2F', size=32)
    ], space_before=280, space_after=100)

def make_h2(title):
    return make_para([
        make_run(title, bold=True, color='1A365D', size=26)
    ], space_before=200, space_after=80)

def make_h3(title):
    return make_para([
        make_run(title, bold=True, color='B45309', size=22)
    ], space_before=140, space_after=60)

def make_bullet(bold_prefix, text):
    return make_para([
        make_run("•  ", bold=True, color='8B1E2F'),
        make_run(bold_prefix + " ", bold=True, color='1A365D'),
        make_run(text, color='2D3748')
    ], space_before=40, space_after=60)

def make_callout(title, body, border_color='B45309', fill_color='FEF3C7'):
    top_p = make_para([make_run(f"★  {title}", bold=True, color=border_color, size=22)], space_before=60, space_after=40)
    body_p = make_para([make_run(body, color='334155', size=20)], space_before=0, space_after=60)
    
    xml = f"""
    <w:tbl>
        <w:tblPr>
            <w:tblW w:w="9400" w:type="dxa"/>
            <w:tblBorders>
                <w:top w:val="single" w:sz="12" w:space="0" w:color="{border_color}"/>
                <w:left w:val="single" w:sz="36" w:space="0" w:color="{border_color}"/>
                <w:bottom w:val="single" w:sz="12" w:space="0" w:color="{border_color}"/>
                <w:right w:val="single" w:sz="12" w:space="0" w:color="{border_color}"/>
            </w:tblBorders>
            <w:tblCellMar>
                <w:top w:w="120" w:type="dxa"/>
                <w:left w:w="180" w:type="dxa"/>
                <w:bottom w:w="120" w:type="dxa"/>
                <w:right w:w="180" w:type="dxa"/>
            </w:tblCellMar>
        </w:tblPr>
        <w:tr>
            <w:tc>
                <w:tcPr>
                    <w:tcW w:w="9400" w:type="dxa"/>
                    <w:shd w:val="clear" w:color="auto" w:fill="{fill_color}"/>
                </w:tcPr>
                {top_p}
                {body_p}
            </w:tc>
        </w:tr>
    </w:tbl>
    """
    return xml

def make_table(headers, rows, col_widths, hdr_bg='1A365D'):
    tbl_xml = []
    total_w = sum(col_widths)
    tbl_xml.append(f"""
    <w:tbl>
        <w:tblPr>
            <w:tblW w:w="{total_w}" w:type="dxa"/>
            <w:tblBorders>
                <w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
                <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            </w:tblBorders>
            <w:tblCellMar>
                <w:top w:w="100" w:type="dxa"/>
                <w:left w:w="140" w:type="dxa"/>
                <w:bottom w:w="100" w:type="dxa"/>
                <w:right w:w="140" w:type="dxa"/>
            </w:tblCellMar>
        </w:tblPr>
    """)

    # Header Row
    tbl_xml.append('<w:tr>')
    for h, w in zip(headers, col_widths):
        tbl_xml.append(f"""
        <w:tc>
            <w:tcPr>
                <w:tcW w:w="{w}" w:type="dxa"/>
                <w:shd w:val="clear" w:color="auto" w:fill="{hdr_bg}"/>
            </w:tcPr>
            <w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="19"/></w:rPr><w:t>{escape_xml(h)}</w:t></w:r></w:p>
        </w:tc>
        """)
    tbl_xml.append('</w:tr>')

    # Data Rows
    for idx, row in enumerate(rows):
        bg = 'F8FAFC' if idx % 2 == 1 else 'FFFFFF'
        tbl_xml.append('<w:tr>')
        for c, w in zip(row, col_widths):
            tbl_xml.append(f"""
            <w:tc>
                <w:tcPr>
                    <w:tcW w:w="{w}" w:type="dxa"/>
                    <w:shd w:val="clear" w:color="auto" w:fill="{bg}"/>
                </w:tcPr>
                <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:color w:val="1E293B"/><w:sz w:val="18"/></w:rPr><w:t>{escape_xml(c)}</w:t></w:r></w:p>
            </w:tc>
            """)
        tbl_xml.append('</w:tr>')

    tbl_xml.append('</w:tbl>')
    return ''.join(tbl_xml)

def generate_document_xml():
    body_elements = []

    # Title Banner
    body_elements.append(make_para([
        make_run("DRONACHARYA (EKALAVYA) LMS", bold=True, color='8B1E2F', size=44)
    ], align='center', space_before=100, space_after=60))
    
    body_elements.append(make_para([
        make_run("Officers Training College (OTC), AMC Centre & College, Lucknow", bold=True, color='1A365D', size=26)
    ], align='center', space_before=0, space_after=40))

    body_elements.append(make_para([
        make_run("Comprehensive System Architecture, Operational Pipelines & End-to-End Workflow Specification", bold=True, color='B45309', size=22)
    ], align='center', space_before=0, space_after=60))

    body_elements.append(make_para([
        make_run("SECURITY CLASSIFICATION: RESTRICTED • FOR OFFICIAL DEFENCE USE ONLY • AIR-GAPPED ON-PREMISE | NOVEMBER 2026", color='64748B', size=18)
    ], align='center', space_before=0, space_after=200))

    # SECTION 1
    body_elements.append(make_h1("1. Executive Summary & Air-Gap Philosophy"))
    body_elements.append(make_para(
        "The Dronacharya (Ekalavya) Learning Management System (LMS) is a dedicated, mission-critical, and completely air-gapped military learning platform engineered for the Officers Training College (OTC), AMC Centre and College, Lucknow. The system delivers tri-service military-medical instruction across 7 standardized officer development courses spanning Medical, Nursing, and Non-Technical officer cohorts.",
        space_after=100
    ))
    body_elements.append(make_callout(
        "MANDATORY AIR-GAP DEFENCE COMPLIANCE",
        "The platform operates under a strict Zero External Network Dependency policy. All runtime assets (video streaming engines, document previewers, CSS stylesheets, JavaScript libraries, icons, fonts, and database repositories) are hosted locally on-premise. No outbound connections to public CDNs, analytics, or cloud APIs exist. An active hardware watchdog continuously monitors local adapters to prevent unauthorized bridging or wireless egress."
    ))

    # SECTION 2
    body_elements.append(make_h1("2. Multi-Zone Infrastructure & Docker/Nginx Topology"))
    body_elements.append(make_para(
        "The platform utilizes an enterprise multi-tier decoupled topology separating the TLS edge proxy from core compute and data persistence:",
        space_after=100
    ))
    arch_headers = ["Tier / Container", "Component", "Network Zone", "Function & Responsibilities"]
    arch_rows = [
        ["Edge Proxy", "Nginx TLS Engine", "Public/Local Subnet", "Terminates TLS 1.3, serves frontend SPA (portal.html), routes /api/* requests to backend."],
        ["App Compute", "PHP 8.3-FPM Router", "App Zone (Isolated)", "Custom micro-router (api/index.php) and Moodle core API handling authentication, RBAC, and data validation."],
        ["Session Cache", "Redis 7.2 In-Memory", "App Zone (Localhost)", "Accelerates authenticated user session state, rate limits, and permission caches."],
        ["Relational DB", "MariaDB / MySQL 8.4", "Data Zone (Air-Gapped)", "Persists relational officer records (mdl_user), courses, enrolment bindings, and immutable audit logs."],
        ["Daemon Service", "Cron Loop & Watchdog", "System Host Service", "Runs scripts/cron-loop.sh every 60s for cohort enrolments and background maintenance tasks."],
        ["Security Watchdog", "Wi-Fi Guard Daemon", "Host Hardware", "Probes system network interfaces every 2 seconds to detect and kill rogue wireless connections."]
    ]
    body_elements.append(make_table(arch_headers, arch_rows, [1800, 2000, 1800, 3800], hdr_bg='1A365D'))

    # SECTION 3
    body_elements.append(make_h1("3. Role-Based Access Control (RBAC) & Permission Hierarchy"))
    body_elements.append(make_para(
        "Access control is enforced at both the database context level and the REST API gateway using Defense-in-Depth principles:",
        space_after=100
    ))
    rbac_headers = ["Role Title", "Internal Identifier", "Context Level", "Core Capabilities & Access Boundaries"]
    rbac_rows = [
        ["Institute Admin", "instituteadmin", "Category Level (OTC)", "Full institutional governance: User provisioning, bulk spreadsheet imports, course additions, deletions, faculty assignments, system-wide audits."],
        ["Course Admin", "courseadmin", "Course Context", "Faculty/Directing Staff: Curriculum authoring, lecture slide (PPT) uploads, interactive video attachments, section creation, trainee evaluation."],
        ["Student Officer", "student", "Enroled Course", "Officer Trainee: Access to enrolled military training syllabi, viewing synchronized presentations, streaming lectures, tracking progress."],
        ["Site Admin", "siteadmin", "System Root", "Protected technical administrator account reserved for database migrations, OS updates, and bare-metal restoration."]
    ]
    body_elements.append(make_table(rbac_headers, rbac_rows, [1800, 1800, 1800, 4000], hdr_bg='8B1E2F'))

    # SECTION 4
    body_elements.append(make_h1("4. Bulk User Upload & Active Status (Yes/No) Pipeline"))
    body_elements.append(make_para(
        "The Bulk User Upload subsystem enables Institute Administrators to batch-provision or update dozens of officer accounts via Excel (.xlsx) or CSV spreadsheets. The ingestion engine enforces strict compliance across 9 standardized columns:",
        space_after=100
    ))
    bulk_headers = ["#", "Field Name", "Code Identifier", "Rule & Validation Specification"]
    bulk_rows = [
        ["1", "Username", "username", "Mandatory. 3–50 alphanumeric chars (dots, underscores, hyphens permitted). Matches Service/Personal Number."],
        ["2", "Password", "password", "Mandatory for new users. Strict Military Policy: Min 12 chars, >=1 uppercase (A-Z), >=1 lowercase (a-z), >=1 digit (0-9), >=1 symbol (!@#$%^&*)."],
        ["3", "First Name", "firstname", "Mandatory. 2–50 characters representing officer first name or initials."],
        ["4", "Last Name / Rank", "lastname", "Mandatory. 2–50 characters representing officer surname or rank designation."],
        ["5", "Official Email", "email", "Mandatory. RFC-compliant military domain email (e.g. officer@amc.gov.in)."],
        ["6", "Mobile Number", "mobile", "Mandatory. Valid mobile phone number containing 10–15 digits (e.g. +91 94150 12001)."],
        ["7", "Active Status", "status", "Mandatory. 'Yes' = Active (suspended=0) | 'No' = Permanently Suspended (suspended=1). Also accepts active/suspended."],
        ["8", "Role / Permissions", "role", "Mandatory. student (Student Officer), courseadmin (Course Admin), or instituteadmin (Institute Admin)."],
        ["9", "Assigned Courses", "courses", "Mandatory for Active officers (e.g. MOBC; MOJCC). Completely OPTIONAL for Permanently Suspended accounts ('None' or blank)."]
    ]
    body_elements.append(make_table(bulk_headers, bulk_rows, [600, 2000, 1800, 5000], hdr_bg='B45309'))

    body_elements.append(make_h2("Key Ingestion Engine Enhancements"))
    body_elements.append(make_bullet("Active Status Protocol:", "Replaced legacy status inputs with intuitive Yes (Active) and No (Permanently Suspended) options in downloadable Excel template dropdowns and UI modals."))
    body_elements.append(make_bullet("Existing User Auto-Updates:", "If an officer already exists in the database, the parser directly updates their account status (e.g., from Active to Permanently Suspended) and course bindings rather than rejecting or skipping the record."))
    body_elements.append(make_bullet("Decoupled Course Requirements for Suspended Personnel:", "When an account is marked as Permanently Suspended (No), course assignment is completely optional, preventing erroneous blocking prompts."))
    body_elements.append(make_bullet("Single-Tick Reactive Navigation:", "The import button is hidden until a spreadsheet is selected. Upon completion, it displays a single clean checkmark [ ✓ Completed ] which directly opens the User Management table upon click."))

    # SECTION 5
    body_elements.append(make_h1("5. Academic Structure & Course Matrix"))
    body_elements.append(make_para(
        "The OTC academic curriculum is structured into 3 distinct training divisions under the primary college umbrella:",
        space_after=100
    ))
    course_headers = ["Category / Division", "Acronym", "Full Official Course Name", "Target Trainee Cadre"]
    course_rows = [
        ["Medical Officers (OTC-MED)", "MOBC", "Medical Officers Basic Course", "Newly commissioned medical officers entering active service."],
        ["Medical Officers (OTC-MED)", "MOJCC", "Medical Officers Junior Command Course", "Mid-level officers transitioning to operational detachment command."],
        ["Medical Officers (OTC-MED)", "MOSCC", "Medical Officers Senior Command Course", "Senior medical officers preparing for hospital / formation leadership."],
        ["Nursing Officers (OTC-NUR)", "BNOC", "Basic Nursing Officers Course", "Commissioned Military Nursing Service (MNS) officers."],
        ["Nursing Officers (OTC-NUR)", "SNOC", "Senior Nursing Officers Course", "Advanced clinical supervision and military field hospital nursing."],
        ["Non-Technical (OTC-NT)", "NTPCC", "Non-Tech Post Commissioning Course", "Administrative, logistical, and records officers."],
        ["Non-Technical (OTC-NT)", "NTADM", "Non-Tech Administration", "Departmental administration and medical store depot logistics."]
    ]
    body_elements.append(make_table(course_headers, course_rows, [2200, 1200, 2800, 3200], hdr_bg='1A365D'))

    # SECTION 6
    body_elements.append(make_h1("6. Presentation (PPT) & Multimedia Streaming Pipeline"))
    body_elements.append(make_para(
        "Faculty and Course Admins can upload lecture presentations (.ppt, .pptx, .pdf) directly to specific course syllabi. The upload pipeline executes the following stages:",
        space_after=80
    ))
    body_elements.append(make_bullet("1. File Sanitization:", "File names are sanitized and MIME types verified to prevent executable or malicious file embedding."))
    body_elements.append(make_bullet("2. Restricted Repository:", "Presentations are stored outside the public document root in an encrypted, permission-guarded directory."))
    body_elements.append(make_bullet("3. High-Performance Protected Delivery:", "Presentations and lecture videos are streamed using Nginx X-Accel-Redirect. The PHP router validates authentication and permissions in milliseconds before handing off byte streaming to Nginx, achieving 0% PHP thread locking."))

    # SECTION 7
    body_elements.append(make_h1("7. Synchronized Digital Classroom & Presentation Controls"))
    body_elements.append(make_para(
        "The Classroom Player provides an immersive, synchronized instructional environment for military medical education:",
        space_after=80
    ))
    body_elements.append(make_bullet("Synchronized Slide Deck Navigation:", "Instructors and student officers navigate high-resolution lecture slides with responsive Previous/Next controls, keyboard shortcuts (Left/Right arrows, Spacebar), and direct slide jumping."))
    body_elements.append(make_bullet("Tactical Fullscreen Mode:", "Zero-distraction presentation view concealing browser chrome for projection onto classroom digital boards."))
    body_elements.append(make_bullet("Zero-Drift Navigation Stack:", "Frontend maintains a resilient navigation history stack ensuring officers can switch between courses, chapters, and the main dashboard seamlessly without losing instructional state."))

    # SECTION 8
    body_elements.append(make_h1("8. Wi-Fi Security Guard & Network Defense Watchdog"))
    body_elements.append(make_para(
        "To comply with Indian Defence air-gap cybersecurity policies, a dual-layer hardware watchdog runs continuously on the host infrastructure:",
        space_after=80
    ))
    body_elements.append(make_bullet("Host Watchdog (scripts/wifi-watchdog.py & .ps1):", "Polls all network adapters every 2 seconds. If an unauthorized Wi-Fi, 4G dongle, or mobile hotspot interface is detected, it is immediately disabled, and a security alert is dispatched."))
    body_elements.append(make_bullet("In-App Wi-Fi Guard (css/wifi-guard.css & js/wifi-guard.js):", "Displays an interactive security shield indicator in the top navbar. In case of network anomalies, an emergency lockout modal is triggered preventing further screen navigation until authorized by administrative credentials."))

    # SECTION 9
    body_elements.append(make_h1("9. Relational Data Model, Immutable Audit Logging & Disaster Recovery"))
    body_elements.append(make_para(
        "Every mutating operation (account creation, deletion, role changes, presentation uploads, course modifications, login failures) is recorded in an immutable audit ledger: mdl_logstore_standard_log / audit_logs capturing timestamp, user ID, IP address, action code, and state changes.",
        space_after=100
    ))
    body_elements.append(make_bullet("Automated Backup Pipeline (scripts/backup.sh):", "Executes automated nightly differential and weekly full backups. It dumps the relational database schema, compresses the moodledata repository, and produces an encrypted archive with SHA-256 integrity checksums."))

    # SECTION 10
    body_elements.append(make_h1("10. Operational Verification & Certification"))
    body_elements.append(make_para(
        "The entire platform has been comprehensively verified using automated test suites (test_admin_rbac.py, 07-security-tests.py, 09-wifi-guard-tests.py). All endpoints have passed zero-trust penetration testing, SQL injection checks, CSRF defenses, and session fixation tests. The platform is fully certified for mission-critical training deployment at OTC Lucknow.",
        space_after=120
    ))

    body_xml = "".join(body_elements)
    
    # Return full document.xml
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <w:body>
        {body_xml}
        <w:sectPr>
            <w:pgSz w:w="11906" w:h="16838"/>
            <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
        </w:sectPr>
    </w:body>
</w:document>"""

def build_docx(template_docx, output_docx):
    # Read existing docx template
    with zipfile.ZipFile(template_docx, 'r') as zin:
        xml_content = generate_document_xml()
        
        with zipfile.ZipFile(output_docx, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == 'word/document.xml':
                    zout.writestr('word/document.xml', xml_content.encode('utf-8'))
                else:
                    zout.writestr(item.filename, zin.read(item.filename))
    print(f"DOCX successfully generated at: {output_docx}")

if __name__ == '__main__':
    template = 'd:/OTC/docs/Ekalavya_LMS_Workflow_and_Pipeline_Specification.docx'
    output_docx = 'd:/OTC/docs/Dronacharya_LMS_Complete_System_and_Workflow_Specification.docx'
    frontend_docx = 'd:/OTC/frontend/Dronacharya_LMS_Complete_System_and_Workflow_Specification.docx'
    
    build_docx(template, output_docx)
    shutil.copyfile(output_docx, frontend_docx)
    print(f"Copied DOCX to frontend at: {frontend_docx}")
