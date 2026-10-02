import Foundation
import Vision
import ImageIO

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
request.usesLanguageCorrection = false
request.customWords = ["UPI", "UTR", "CRED", "INR", "₹"]
do {
    try VNImageRequestHandler(cgImage: image).perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    let output = try JSONSerialization.data(withJSONObject: ["text": lines.joined(separator: "\n")])
    FileHandle.standardOutput.write(output)
} catch {
    exit(1)
}
