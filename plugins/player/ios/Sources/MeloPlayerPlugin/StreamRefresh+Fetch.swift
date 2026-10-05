#if os(iOS)
import Foundation
import MeloPlayerCore

extension StreamRefresh {
    /// Gửi lại yêu cầu `/player` bằng `session` của app (cùng IP, cùng cookie với JS) rồi lấy link mới.
    func fetchStreamURL(session: URLSession, completion: @escaping (Result<URL, Error>) -> Void) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.httpBody = body
        session.dataTask(with: request) { data, response, error in
            if let error { return completion(.failure(error)) }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200, let data, let url = self.streamURL(fromPlayerResponse: data) else {
                let message = status == 200 ? "YouTube không trả link dùng được" : "YouTube trả mã HTTP \(status)"
                return completion(.failure(NSError(domain: "MeloStream", code: status, userInfo: [NSLocalizedDescriptionKey: message])))
            }
            completion(.success(url))
        }.resume()
    }

    func fetchStreamURL(session: URLSession) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            fetchStreamURL(session: session) { continuation.resume(with: $0) }
        }
    }
}
#endif
