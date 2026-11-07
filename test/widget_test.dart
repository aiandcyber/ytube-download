import 'package:flutter_test/flutter_test.dart';
import 'package:ytube_download/main.dart';

void main() {
  testWidgets('shows YouTube download screen', (tester) async {
    await tester.pumpWidget(const YtubeApp());
    expect(find.text('YouTube Download'), findsOneWidget);
    expect(find.text('YouTube to MP4'), findsOneWidget);
    expect(find.text('Run'), findsOneWidget);
  });
}
